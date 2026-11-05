CREATE TABLE `payroll_lines` (
	`id` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`profileId` varchar(36),
	`payType` enum('Daily','Monthly') NOT NULL,
	`workedDaysHundredths` int NOT NULL,
	`paidDaysHundredths` int NOT NULL,
	`paidDaysEdited` enum('Yes','No') NOT NULL DEFAULT 'No',
	`overtimeHundredths` int NOT NULL,
	`basicMinor` decimal(18,0) NOT NULL,
	`hraMinor` decimal(18,0) NOT NULL,
	`otherAllowanceMinor` decimal(18,0) NOT NULL,
	`overtimeMinor` decimal(18,0) NOT NULL,
	`grossMinor` decimal(18,0) NOT NULL,
	`pfWageMinor` decimal(18,0) NOT NULL,
	`pfEmployeeMinor` decimal(18,0) NOT NULL,
	`esiEmployeeMinor` decimal(18,0) NOT NULL,
	`ptMinor` decimal(18,0) NOT NULL,
	`tdsMinor` decimal(18,0) NOT NULL,
	`advanceMinor` decimal(18,0) NOT NULL,
	`otherDeductionMinor` decimal(18,0) NOT NULL,
	`otherDeductionNote` varchar(200),
	`netMinor` decimal(18,0) NOT NULL,
	`employerEpfMinor` decimal(18,0) NOT NULL,
	`employerEpsMinor` decimal(18,0) NOT NULL,
	`edliAdminMinor` decimal(18,0) NOT NULL,
	`esiEmployerMinor` decimal(18,0) NOT NULL,
	`costMinor` decimal(18,0) NOT NULL,
	`warnings` text,
	CONSTRAINT `payroll_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_line_run_person_uq` UNIQUE(`runId`,`personId`)
);
--> statement-breakpoint
CREATE TABLE `payroll_profiles` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`payType` enum('Daily','Monthly') NOT NULL,
	`basicMinor` decimal(18,0) NOT NULL,
	`hraMinor` decimal(18,0) NOT NULL,
	`otherAllowanceMinor` decimal(18,0) NOT NULL,
	`pfMember` enum('Yes','No') NOT NULL,
	`esiMember` enum('Yes','No') NOT NULL,
	`ptApplies` enum('Yes','No') NOT NULL,
	`uan` varchar(12),
	`esiNumber` varchar(10),
	`effectiveFrom` date NOT NULL,
	`status` enum('Pending','Active','Superseded','Rejected') NOT NULL DEFAULT 'Pending',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_profiles_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`runNumber` varchar(40) NOT NULL,
	`month` varchar(7) NOT NULL,
	`status` enum('Draft','Submitted','Approved','Paid','Returned','Cancelled') NOT NULL DEFAULT 'Draft',
	`ratesSnapshot` text NOT NULL,
	`lineCount` int NOT NULL,
	`grossMinor` decimal(18,0) NOT NULL,
	`deductionMinor` decimal(18,0) NOT NULL,
	`netMinor` decimal(18,0) NOT NULL,
	`pfDueMinor` decimal(18,0) NOT NULL,
	`esiDueMinor` decimal(18,0) NOT NULL,
	`ptDueMinor` decimal(18,0) NOT NULL,
	`tdsDueMinor` decimal(18,0) NOT NULL,
	`costMinor` decimal(18,0) NOT NULL,
	`submittedAt` timestamp,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`paidOn` date,
	`paymentMode` enum('Bank transfer','UPI','Cheque','Cash'),
	`paymentReference` varchar(120),
	`paidBy` int,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payroll_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_runs_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `payroll_run_org_number_uq` UNIQUE(`organizationId`,`runNumber`)
);
--> statement-breakpoint
CREATE TABLE `payroll_settings` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`effectiveFrom` date NOT NULL,
	`pfWageCeilingMinor` decimal(18,0) NOT NULL,
	`pfEmployeeBps` int NOT NULL,
	`pfEmployerBps` int NOT NULL,
	`epsBps` int NOT NULL,
	`epsCeilingMinor` decimal(18,0) NOT NULL,
	`edliBps` int NOT NULL,
	`pfAdminBps` int NOT NULL,
	`esiThresholdMinor` decimal(18,0) NOT NULL,
	`esiEmployeeBps` int NOT NULL,
	`esiEmployerBps` int NOT NULL,
	`overtimeMultiplierBps` int NOT NULL,
	`wageShareBps` int NOT NULL,
	`ptSlabs` text,
	`note` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payroll_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `payroll_settings_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `payroll_settings_org_from_uq` UNIQUE(`organizationId`,`effectiveFrom`)
);
--> statement-breakpoint
CREATE TABLE `statutory_deposits` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`kind` enum('PF','ESI','PT','TDS salary','TDS contractor') NOT NULL,
	`period` varchar(7) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`paidOn` date NOT NULL,
	`challanReference` varchar(80) NOT NULL,
	`note` text,
	`status` enum('Recorded','Reversed') NOT NULL DEFAULT 'Recorded',
	`reversedBy` int,
	`reversedAt` timestamp,
	`reverseReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `statutory_deposits_id` PRIMARY KEY(`id`),
	CONSTRAINT `statutory_deposits_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_runId_payroll_runs_id_fk` FOREIGN KEY (`runId`) REFERENCES `payroll_runs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_lines` ADD CONSTRAINT `payroll_lines_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_profiles` ADD CONSTRAINT `payroll_profiles_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_profiles` ADD CONSTRAINT `payroll_profiles_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_profiles` ADD CONSTRAINT `payroll_profiles_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_profiles` ADD CONSTRAINT `payroll_profiles_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_profiles` ADD CONSTRAINT `payroll_profiles_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_paidBy_users_id_fk` FOREIGN KEY (`paidBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_settings` ADD CONSTRAINT `payroll_settings_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payroll_settings` ADD CONSTRAINT `payroll_settings_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statutory_deposits` ADD CONSTRAINT `statutory_deposits_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statutory_deposits` ADD CONSTRAINT `statutory_deposits_reversedBy_users_id_fk` FOREIGN KEY (`reversedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statutory_deposits` ADD CONSTRAINT `statutory_deposits_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `payroll_profile_site_idx` ON `payroll_profiles` (`siteId`,`personId`,`status`);--> statement-breakpoint
CREATE INDEX `payroll_run_site_month_idx` ON `payroll_runs` (`siteId`,`month`);--> statement-breakpoint
CREATE INDEX `statutory_deposit_org_period_idx` ON `statutory_deposits` (`organizationId`,`kind`,`period`);