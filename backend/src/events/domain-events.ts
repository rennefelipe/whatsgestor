import { Global, Injectable, Module } from '@nestjs/common';

export interface DomainEvent {
  automaticEvent?: 'waiting' | 'started' | 'transferred' | 'finished';
  transitionKey?: string;
  type: 'message.created' | 'message.changed' | 'attendance.changed' | 'connection.changed' | 'resync_required';
  connectionId?: string;
  conversationId?: string;
  messageId?: string;
  at: string;
}
@Injectable()
export class DomainEvents {
  private listeners = new Set<(event: DomainEvent) => void>();
  emit(event: Omit<DomainEvent, 'at'>): void {
    const value = { ...event, at: new Date().toISOString() };
    for (const listener of this.listeners) { try { listener(value); } catch { /* Observers never roll back business commits. */ } }
  }
  subscribe(listener: (event: DomainEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}
