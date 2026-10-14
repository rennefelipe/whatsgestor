-- SOMENTE VALIDACAO. Usar no SSMS em DESKTOP-T3R6HCI com conta DBA ja autorizada.
-- Nao concede permissoes, nao cria bancos, nao restaura dados e nao executa migrations.
USE [master];
GO
DECLARE @backupFile nvarchar(4000) = N'C:\Program Files\Microsoft SQL Server\MSSQL16.MSSQLSERVER\MSSQL\Backup\WhatsGestor_pre_media_20261009_175942_B466782F.bak';
BEGIN TRY
  RESTORE HEADERONLY FROM DISK = @backupFile;
  RESTORE VERIFYONLY FROM DISK = @backupFile WITH FILE = 1, CHECKSUM, STOP_ON_ERROR;
END TRY
BEGIN CATCH
  SELECT ERROR_NUMBER() AS ErrorNumber, ERROR_STATE() AS ErrorState,
         ERROR_SEVERITY() AS ErrorSeverity, ERROR_MESSAGE() AS ErrorMessage;
  THROW;
END CATCH;
-- Conferir DatabaseName=WhatsGestor, BackupType=1, Position=1,
-- IsCopyOnly=1, HasBackupChecksums=1 no HEADERONLY e sucesso no VERIFYONLY.
-- VERIFYONLY nao substitui restauracao de teste; nenhuma restauracao faz parte desta etapa.
