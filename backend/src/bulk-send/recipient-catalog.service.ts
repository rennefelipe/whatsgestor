import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { ContactsService } from '../contacts/contacts.service';
import { ContactCampaignPreferencesService } from '../contacts/contact-campaign-preferences.service';
import type { CampaignPreferencesSnapshot } from '../contacts/contact-campaign-preferences.service';
import { FindContactsQueryDto } from '../contacts/dto/find-contacts-query.dto';
import { WhatsappConversation } from '../whatsapp-conversations/entities/whatsapp-conversation.entity';
import { recipientPhone } from './recipient-phone';
import { normalizeStoreName } from '../contacts/contact-normalization';

export type ContextContact = Awaited<
  ReturnType<ContactsService['findByIds']>
>[number];
export interface Recipient {
  organizationId: string | null;
  groupId: string | null;
  roleId: string;
  normalizationVersion: string;
  sourceSnapshots: RecipientSourceSnapshot[];
  key: string;
  contactIds: string[];
  names: string[];
  originalPhones: string[];
  normalizedPhone: string | null;
  candidateJid: string | null;
  knownIdentities: string[];
  group: string | null;
  shopping: string | null;
  shoppingId: string | null;
  organization: string | null;
  storeName: string | null;
  role: string | null;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  platformStatus: 'not_verified';
  verifiedIdentityScopes: string[];
}
export const NORMALIZATION_VERSION = 'nfc-e164-context-v1';
export interface RecipientSourceSnapshot {
  identityEvidence: {
    connectionId: string;
    whatsappIdentity: string;
    conversationId: string;
  }[];
  verifiedIdentityScopes: string[];
  contactId: string;
  contactName: string;
  originalPhone: string;
  normalizedPhone: string | null;
  organizationId: string | null;
  organization: string | null;
  organizationType: string | null;
  groupId: string | null;
  group: string | null;
  shoppingId: string | null;
  shopping: string | null;
  storeName: string | null;
  normalizedStoreName: string | null;
  roleId: string;
  role: string | null;
  isActive: boolean;
  roleActive: boolean;
  organizationActive: boolean | null;
  hierarchyIssue: string | null;
  normalizationVersion: string;
}
const canonicalId = (value?: string | null) => value?.toLowerCase() ?? null;
export const MAX_RECIPIENT_RECORDS = 10000;

@Injectable()
export class RecipientCatalogService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly preferences: ContactCampaignPreferencesService,
    @InjectRepository(WhatsappConversation)
    private readonly conversations: Repository<WhatsappConversation>,
  ) {}

  async query(filters: FindContactsQueryDto) {
    // Two bounded full reads detect equal-count edits/deletes/inserts as well as
    // hierarchy/type changes. This is optimistic validation, not DB snapshot
    // isolation; it never changes the server/database isolation configuration.
    const contacts = await this.contacts.selectionCandidates(
      filters,
      MAX_RECIPIENT_RECORDS,
    );
    const check = await this.contacts.selectionCandidates(
      filters,
      MAX_RECIPIENT_RECORDS,
    );
    const fingerprint = (rows: ContextContact[]) =>
      createHash('sha256')
        .update(
          JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id))),
        )
        .digest('hex');
    if (fingerprint(contacts) !== fingerprint(check))
      throw new ConflictException(
        'Os cadastros mudaram durante a consulta. Atualize os filtros e tente novamente.',
      );
    return this.project(contacts);
  }

  async fromIds(ids: string[]) {
    return this.project(await this.contacts.findByIds(ids));
  }

  async project(contacts: ContextContact[]) {
    const preferences = await this.preferences.snapshot(); // Errors propagate; never silently ignore registry failures.
    if (preferences.status !== 'available')
      throw new ServiceUnavailableException(
        'Preferências de campanhas indisponíveis. Atualize a consulta antes de continuar.',
      );
    const parsedPhones = new Map<string, ReturnType<typeof recipientPhone>>();
    const parsePhone = (value: string) => {
      let parsed = parsedPhones.get(value);
      if (!parsed) {
        parsed = recipientPhone(value);
        parsedPhones.set(value, parsed);
      }
      return parsed;
    };
    const identities = new Map<string, Set<string>>();
    const phoneIdentities = new Map<string, Set<string>>();
    const scopes = new Map<string, Set<string>>();
    const identityEvidence = new Map<
      string,
      RecipientSourceSnapshot['identityEvidence']
    >();
    const ids = contacts.map((contact) => contact.id);
    // Read linked identities once, in bounded candidate volume. A SQL REPLACE
    // approximation can miss aliases that libphonenumber considers equivalent.
    // Limit+error protects memory and never treats truncated links as complete.
    if (ids.length) {
      const requestedIds = new Set(ids);
      const requestedPhones = new Set(
        contacts.flatMap((contact) => {
          const phone = parsePhone(contact.phone).normalizedPhone;
          return phone ? [phone] : [];
        }),
      );
      let scanned = 0;
      let cursor: string | null = null;
      for (;;) {
        const query = this.conversations
          .createQueryBuilder('conversation')
          .innerJoin('conversation.contact', 'identityContact')
          .select('conversation.contactId', 'contactId')
          .addSelect('conversation.id', 'id')
          .addSelect('conversation.remoteJid', 'remoteJid')
          .addSelect('identityContact.phone', 'phone')
          .addSelect('conversation.connectionId', 'connectionId')
          .orderBy('conversation.id', 'ASC')
          .limit(500);
        if (cursor)
          query.where('conversation.id > :identityCursor', {
            identityCursor: cursor,
          });
        const linked = await query.getRawMany<{
          id: string;
          contactId: string;
          remoteJid: string;
          phone: string;
          connectionId?: string;
        }>();
        scanned += linked.length;
        if (scanned > 50000)
          throw new BadRequestException(
            'Limite de leitura de identidades atingido (50.000 vínculos). Nenhuma seleção parcial foi retornada.',
          );
        for (const link of linked) {
          const linkedPhone = recipientPhone(link.phone).normalizedPhone;
          if (
            !requestedIds.has(link.contactId) &&
            (!linkedPhone || !requestedPhones.has(linkedPhone))
          )
            continue;
          if (
            link.contactId &&
            /^[^@\s]+@(?:s\.whatsapp\.net|lid)$/.test(link.remoteJid)
          ) {
            const contactLinks =
              identities.get(link.contactId) ?? new Set<string>();
            contactLinks.add(link.remoteJid);
            identities.set(link.contactId, contactLinks);
            if (requestedIds.has(link.contactId) && link.connectionId) {
              const confirmed = scopes.get(link.contactId) ?? new Set<string>();
              confirmed.add(
                `${link.connectionId.toLowerCase()}|${link.remoteJid}`,
              );
              scopes.set(link.contactId, confirmed);
              const evidence = identityEvidence.get(link.contactId) ?? [];
              evidence.push({
                connectionId: link.connectionId,
                whatsappIdentity: link.remoteJid,
                conversationId: link.id,
              });
              identityEvidence.set(link.contactId, evidence);
            }
            const phone = linkedPhone;
            if (phone) {
              const phoneLinks =
                phoneIdentities.get(phone) ?? new Set<string>();
              phoneLinks.add(link.remoteJid);
              phoneIdentities.set(phone, phoneLinks);
            }
          }
        }
        if (linked.length < 500) break;
        cursor = linked[linked.length - 1].id;
      }
    }
    const recipients = new Map<string, Recipient>();
    const names = new Map<string, Set<string>>();
    let identityAssociations = 0;
    for (const contact of contacts) {
      const phone = parsePhone(contact.phone);
      const context = contact.organizationContext;
      const key = createHash('sha256')
        .update(
          JSON.stringify([
            phone.normalizedPhone ?? `invalid:${contact.id}`,
            canonicalId(contact.organizationId),
            canonicalId(context?.group?.id),
            canonicalId(context?.shopping?.id),
            normalizeStoreName(contact.storeName),
            canonicalId(contact.contactTypeId),
          ]),
        )
        .digest('hex');
      const reasons: string[] = [];
      const warnings: string[] = [];
      if (phone.reason) reasons.push(phone.reason);
      if (!contact.isActive) reasons.push('Contato inativo');
      if (!contact.contactType?.isActive)
        reasons.push('Função ausente ou inativa');
      if (contact.organizationId && !contact.organization?.isActive)
        reasons.push('Organização ausente ou inativa');
      if (context?.hierarchyIssue) reasons.push(context.hierarchyIssue);
      if (!contact.contactName.trim())
        reasons.push('Responsável não informado');
      if (!context?.group) warnings.push('Grupo não informado');
      if (!context?.shopping) warnings.push('Shopping não informado');
      identityAssociations +=
        (identities.get(contact.id)?.size ?? 0) +
        (phone.normalizedPhone
          ? (phoneIdentities.get(phone.normalizedPhone)?.size ?? 0)
          : 0);
      if (identityAssociations > 1000000)
        throw new BadRequestException(
          'Limite de associações de identidade atingido. Nenhuma seleção parcial foi retornada.',
        );
      const knownIdentities = [
        ...new Set([
          ...(identities.get(contact.id) ?? []),
          ...(phone.normalizedPhone
            ? (phoneIdentities.get(phone.normalizedPhone) ?? [])
            : []),
        ]),
      ];
      if (
        knownIdentities.some(
          (jid) =>
            jid.endsWith('@s.whatsapp.net') && jid !== phone.candidateJid,
        )
      )
        reasons.push(
          'Vínculo WhatsApp diverge do telefone; conferir em Contatos',
        );
      const row: Recipient = {
        organizationId: contact.organizationId,
        groupId: context?.group?.id ?? null,
        roleId: contact.contactTypeId,
        normalizationVersion: NORMALIZATION_VERSION,
        sourceSnapshots: [
          {
            identityEvidence: (identityEvidence.get(contact.id) ?? []).sort(
              (a, b) => a.conversationId.localeCompare(b.conversationId),
            ),
            verifiedIdentityScopes: [...(scopes.get(contact.id) ?? [])].sort(),
            contactId: contact.id,
            contactName: contact.contactName,
            originalPhone: contact.phone,
            normalizedPhone: phone.normalizedPhone,
            organizationId: contact.organizationId,
            organization: contact.organization?.name ?? null,
            organizationType: context?.organizationType ?? null,
            groupId: context?.group?.id ?? null,
            group: context?.group?.name ?? null,
            shoppingId: context?.shopping?.id ?? null,
            shopping: context?.shopping?.name ?? null,
            storeName: contact.storeName,
            normalizedStoreName: normalizeStoreName(contact.storeName),
            roleId: contact.contactTypeId,
            role: contact.contactType?.name ?? null,
            isActive: contact.isActive,
            roleActive: !!contact.contactType?.isActive,
            organizationActive: contact.organizationId
              ? !!contact.organization?.isActive
              : null,
            hierarchyIssue: context?.hierarchyIssue ?? null,
            normalizationVersion: NORMALIZATION_VERSION,
          },
        ],
        key,
        contactIds: [contact.id],
        names: [contact.contactName],
        originalPhones: [contact.phone],
        normalizedPhone: phone.normalizedPhone,
        candidateJid: phone.candidateJid,
        knownIdentities,
        group: context?.group?.name ?? null,
        shopping: context?.shopping?.name ?? null,
        shoppingId: context?.shopping?.id ?? null,
        organization: contact.organization?.name ?? null,
        storeName: contact.storeName?.trim() || null,
        role: contact.contactType?.name ?? null,
        eligible: reasons.length === 0,
        reasons,
        warnings,
        platformStatus: 'not_verified',
        verifiedIdentityScopes: [...(scopes.get(contact.id) ?? [])],
      };
      const previous = recipients.get(key);
      if (previous) {
        previous.contactIds.push(contact.id);
        previous.sourceSnapshots.push(...row.sourceSnapshots);
        names.get(key)!.add(contact.contactName);
        previous.originalPhones = [
          ...new Set([...previous.originalPhones, contact.phone]),
        ];
        previous.knownIdentities = [
          ...new Set([...previous.knownIdentities, ...knownIdentities]),
        ];
        previous.verifiedIdentityScopes = [
          ...new Set([
            ...previous.verifiedIdentityScopes,
            ...row.verifiedIdentityScopes,
          ]),
        ];
        // An inactive duplicate alone cannot prevent selection of the active original.
        const sharedReasons = [
          ...new Set([...previous.reasons, ...reasons]),
        ].filter((reason) => reason !== 'Contato inativo');
        previous.eligible =
          (previous.eligible || row.eligible) && sharedReasons.length === 0;
        previous.reasons = previous.eligible
          ? []
          : sharedReasons.length
            ? sharedReasons
            : ['Contato inativo'];
        previous.warnings = [
          ...new Set([
            ...previous.warnings,
            ...warnings,
            'Cadastros repetidos no mesmo telefone e contexto',
          ]),
        ];
        if (reasons.includes('Contato inativo'))
          previous.warnings.push('Inclui cadastro inativo');
      } else {
        recipients.set(key, row);
        names.set(key, new Set(row.names));
      }
    }
    for (const [key, recipient] of recipients)
      recipient.names = [...names.get(key)!];
    const rows = [...recipients.values()].sort(
      (a, b) =>
        a.names[0].localeCompare(b.names[0], 'pt-BR') ||
        a.key.localeCompare(b.key),
    );
    for (const row of rows) this.applyRestrictions(row, preferences);
    const counts = new Map<string, number>();
    for (const row of rows)
      if (row.normalizedPhone)
        counts.set(
          row.normalizedPhone,
          (counts.get(row.normalizedPhone) ?? 0) + 1,
        );
    for (const row of rows)
      if (row.normalizedPhone && (counts.get(row.normalizedPhone) ?? 0) > 1)
        row.warnings.push(
          'Mesmo número em contextos diferentes; poderá receber mais de uma mensagem',
        );
    return {
      rows,
      recordsFound: contacts.length,
      preferencesStatus: preferences.status,
    };
  }

  private applyRestrictions(
    row: Recipient,
    preferences: CampaignPreferencesSnapshot,
  ) {
    const matching = preferences.rules.filter(
      (rule) =>
        (rule.normalizedPhone &&
          rule.normalizedPhone === row.normalizedPhone) ||
        (rule.whatsappIdentity &&
          rule.connectionId &&
          row.verifiedIdentityScopes.includes(
            `${rule.connectionId.toLowerCase()}|${rule.whatsappIdentity}`,
          )),
    );
    const global = matching.find((rule) => !rule.shoppingId);
    for (const rule of global ? [global] : matching) {
      if (
        !rule.shoppingId ||
        !row.shoppingId ||
        rule.shoppingId.toLowerCase() === row.shoppingId.toLowerCase()
      ) {
        row.eligible = false;
        row.reasons.push(
          !rule.shoppingId
            ? 'Não recebimento global de campanhas'
            : !row.shoppingId
              ? 'Shopping ausente: restrição de campanhas não pode ser verificada'
              : 'Não recebimento de campanhas neste shopping',
        );
      }
    }
    row.reasons = [...new Set(row.reasons)];
  }
}
