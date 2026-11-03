-- DBA only. Review target name and instance before executing manually.
-- Never reuse the name of an existing operational database.
USE [master];
GO
IF DB_ID(N'WhatsGestor') IS NOT NULL
    THROW 51000, N'TARGET_DATABASE_ALREADY_EXISTS', 1;
ELSE
    EXEC(N'CREATE DATABASE [WhatsGestor]');
GO
-- Provision a dedicated SQL login/user and permissions separately through your DBA.
-- No passwords, logins or existing data are included in this script.
