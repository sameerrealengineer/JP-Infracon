ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_report_site_kind_date_shift_revision_uq` UNIQUE(`siteId`,`reportKind`,`reportDate`,`shiftCode`,`revisionNumber`);--> statement-breakpoint
ALTER TABLE `daily_reports` DROP INDEX `daily_report_site_date_shift_revision_uq`;
