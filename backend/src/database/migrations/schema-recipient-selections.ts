// Frozen additive schema; generated offline. Never regenerate an applied migration.
export const RECIPIENT_TABLES = [
  "recipient_selections",
  "recipient_selection_revisions",
  "recipient_selection_items",
  "recipient_selection_sources",
  "recipient_selection_operations"
] as const;
export const RECIPIENT_COLUMNS = {
  "recipient_selections": [
    "id",
    "ownerId",
    "currentRevisionId",
    "activeOperationId",
    "lastOperationId",
    "version",
    "retained",
    "slot",
    "expiresAt",
    "createdAt",
    "updatedAt"
  ],
  "recipient_selection_revisions": [
    "id",
    "selectionId",
    "version",
    "status",
    "metadata",
    "normalizationVersion",
    "createdAt"
  ],
  "recipient_selection_items": [
    "id",
    "revisionId",
    "contextKey",
    "ordinal",
    "selected",
    "inQuery",
    "snapshot"
  ],
  "recipient_selection_sources": [
    "id",
    "revisionId",
    "itemId",
    "contactId",
    "snapshot"
  ],
  "recipient_selection_operations": [
    "id",
    "selectionId",
    "ownerId",
    "requestId",
    "revisionId",
    "leaseToken",
    "leaseExpiresAt",
    "baseVersion",
    "attempt",
    "status",
    "input",
    "errors",
    "processed",
    "total",
    "createdAt",
    "updatedAt"
  ]
} as const;
export const RECIPIENT_SQL: readonly string[] = [
  "CREATE TABLE \"dbo\".\"recipient_selections\" (\"id\" uniqueidentifier NOT NULL, \"ownerId\" uniqueidentifier NOT NULL, \"currentRevisionId\" uniqueidentifier, \"activeOperationId\" uniqueidentifier, \"lastOperationId\" uniqueidentifier, \"version\" int NOT NULL CONSTRAINT \"DF_d5ea166570fee306adc9fda629b\" DEFAULT 0, \"retained\" bit NOT NULL CONSTRAINT \"DF_06caa248791e68f842f666961d8\" DEFAULT 0, \"slot\" int, \"expiresAt\" datetime2, \"createdAt\" datetime2 NOT NULL CONSTRAINT \"DF_9965473e9df3733382a41994539\" DEFAULT SYSUTCDATETIME(), \"updatedAt\" datetime2 NOT NULL, CONSTRAINT \"CK_recipient_selections_version\" CHECK ([version]>=0 AND ([slot] IS NULL OR [slot] BETWEEN 0 AND 2) AND ([retained]=0 OR [slot] IS NULL)), CONSTRAINT \"CK_recipient_selections_retention\" CHECK (([retained]=1 AND [expiresAt] IS NULL) OR ([retained]=0 AND [expiresAt] IS NOT NULL)), CONSTRAINT \"PK_329d559f1777b2de9e60787627e\" PRIMARY KEY (\"id\"))",
  "CREATE UNIQUE INDEX \"UQ_recipient_selections_slot\" ON \"dbo\".\"recipient_selections\" (\"ownerId\", \"slot\") WHERE [slot] IS NOT NULL",
  "CREATE INDEX \"IX_recipient_selections_owner\" ON \"dbo\".\"recipient_selections\" (\"ownerId\", \"updatedAt\", \"id\") ",
  "CREATE TABLE \"dbo\".\"recipient_selection_revisions\" (\"id\" uniqueidentifier NOT NULL, \"selectionId\" uniqueidentifier NOT NULL, \"version\" int NOT NULL, \"status\" nvarchar(12) NOT NULL, \"metadata\" nvarchar(MAX) NOT NULL, \"normalizationVersion\" nvarchar(50) NOT NULL, \"createdAt\" datetime2 NOT NULL CONSTRAINT \"DF_8c52ad89534687974ebf200cd4f\" DEFAULT SYSUTCDATETIME(), CONSTRAINT \"CK_recipient_revisions_status\" CHECK ([status] IN (N'building',N'ready',N'failed') AND [version]>0), CONSTRAINT \"PK_2a8ec039ca6b83b02377265a6ff\" PRIMARY KEY (\"id\"))",
  "CREATE UNIQUE INDEX \"UQ_recipient_revisions_published\" ON \"dbo\".\"recipient_selection_revisions\" (\"selectionId\", \"version\") WHERE [status] = N'ready'",
  "CREATE INDEX \"IX_recipient_revisions_selection\" ON \"dbo\".\"recipient_selection_revisions\" (\"selectionId\", \"version\") ",
  "CREATE TABLE \"dbo\".\"recipient_selection_items\" (\"id\" uniqueidentifier NOT NULL, \"revisionId\" uniqueidentifier NOT NULL, \"contextKey\" nvarchar(64) COLLATE Latin1_General_100_BIN2 NOT NULL, \"ordinal\" int NOT NULL, \"selected\" bit NOT NULL, \"inQuery\" bit NOT NULL, \"snapshot\" nvarchar(MAX) NOT NULL, CONSTRAINT \"PK_6eb1484454017feb9968763aa63\" PRIMARY KEY (\"id\"))",
  "CREATE UNIQUE INDEX \"UQ_recipient_items_ordinal\" ON \"dbo\".\"recipient_selection_items\" (\"revisionId\", \"ordinal\") ",
  "CREATE UNIQUE INDEX \"UQ_recipient_items_context\" ON \"dbo\".\"recipient_selection_items\" (\"revisionId\", \"contextKey\", \"selected\") ",
  "CREATE TABLE \"dbo\".\"recipient_selection_sources\" (\"id\" uniqueidentifier NOT NULL, \"revisionId\" uniqueidentifier NOT NULL, \"itemId\" uniqueidentifier NOT NULL, \"contactId\" uniqueidentifier NOT NULL, \"snapshot\" nvarchar(MAX) NOT NULL, CONSTRAINT \"PK_eee99e5ccfd7f1f96ea22b90a00\" PRIMARY KEY (\"id\"))",
  "CREATE INDEX \"IX_recipient_sources_revision\" ON \"dbo\".\"recipient_selection_sources\" (\"revisionId\", \"id\") ",
  "CREATE UNIQUE INDEX \"UQ_recipient_sources_contact\" ON \"dbo\".\"recipient_selection_sources\" (\"itemId\", \"contactId\") ",
  "CREATE TABLE \"dbo\".\"recipient_selection_operations\" (\"id\" uniqueidentifier NOT NULL, \"selectionId\" uniqueidentifier NOT NULL, \"ownerId\" uniqueidentifier NOT NULL, \"requestId\" uniqueidentifier NOT NULL, \"revisionId\" uniqueidentifier NOT NULL, \"leaseToken\" uniqueidentifier NOT NULL, \"leaseExpiresAt\" datetime2 NOT NULL, \"baseVersion\" int NOT NULL, \"attempt\" int NOT NULL, \"status\" nvarchar(12) NOT NULL, \"input\" nvarchar(MAX) NOT NULL, \"errors\" nvarchar(MAX) NOT NULL, \"processed\" int NOT NULL, \"total\" int NOT NULL, \"createdAt\" datetime2 NOT NULL CONSTRAINT \"DF_8ba532f86cba6c0f99ab3e17a55\" DEFAULT SYSUTCDATETIME(), \"updatedAt\" datetime2 NOT NULL, CONSTRAINT \"CK_recipient_operations_status\" CHECK ([status] IN (N'building',N'completed',N'failed') AND [processed]>=0 AND [total]>=0 AND [processed]<=[total] AND [attempt]>0), CONSTRAINT \"PK_a781dfc3aff1cdfdb70554ed11b\" PRIMARY KEY (\"id\"))",
  "CREATE INDEX \"IX_recipient_operations_selection\" ON \"dbo\".\"recipient_selection_operations\" (\"selectionId\", \"createdAt\") ",
  "CREATE UNIQUE INDEX \"UQ_recipient_operations_request\" ON \"dbo\".\"recipient_selection_operations\" (\"ownerId\", \"requestId\") ",
  "ALTER TABLE \"dbo\".\"recipient_selection_revisions\" ADD CONSTRAINT \"FK_recipient_revisions_selection\" FOREIGN KEY (\"selectionId\") REFERENCES \"dbo\".\"recipient_selections\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION",
  "ALTER TABLE \"dbo\".\"recipient_selection_items\" ADD CONSTRAINT \"FK_recipient_items_revision\" FOREIGN KEY (\"revisionId\") REFERENCES \"dbo\".\"recipient_selection_revisions\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION",
  "ALTER TABLE \"dbo\".\"recipient_selection_sources\" ADD CONSTRAINT \"FK_recipient_sources_revision\" FOREIGN KEY (\"revisionId\") REFERENCES \"dbo\".\"recipient_selection_revisions\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION",
  "ALTER TABLE \"dbo\".\"recipient_selection_sources\" ADD CONSTRAINT \"FK_recipient_sources_item\" FOREIGN KEY (\"itemId\") REFERENCES \"dbo\".\"recipient_selection_items\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION",
  "ALTER TABLE \"dbo\".\"recipient_selection_operations\" ADD CONSTRAINT \"FK_recipient_operations_selection\" FOREIGN KEY (\"selectionId\") REFERENCES \"dbo\".\"recipient_selections\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION",
  "ALTER TABLE \"dbo\".\"recipient_selection_operations\" ADD CONSTRAINT \"FK_recipient_operations_revision\" FOREIGN KEY (\"revisionId\") REFERENCES \"dbo\".\"recipient_selection_revisions\"(\"id\") ON DELETE NO ACTION ON UPDATE NO ACTION"
];
