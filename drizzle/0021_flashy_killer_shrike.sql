CREATE TABLE `client_bill_lines` (
	`id` varchar(36) NOT NULL,
	`billId` varchar(36) NOT NULL,
	`contractItemId` varchar(36),
	`lineNumber` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`unit` varchar(20) NOT NULL,
	`quantityThousandths` decimal(18,0) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	CONSTRAINT `client_bill_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `client_bills` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`clientId` varchar(36) NOT NULL,
	`billNumber` varchar(40) NOT NULL,
	`billDate` date NOT NULL,
	`periodFrom` date,
	`periodTo` date,
	`status` enum('Draft','Submitted','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Draft',
	`gstBps` int NOT NULL,
	`retentionBps` int NOT NULL,
	`tdsBps` int NOT NULL,
	`workValueMinor` decimal(18,0) NOT NULL,
	`gstMinor` decimal(18,0) NOT NULL,
	`retentionMinor` decimal(18,0) NOT NULL,
	`tdsMinor` decimal(18,0) NOT NULL,
	`otherDeductionMinor` decimal(18,0) NOT NULL,
	`otherDeductionNote` varchar(300),
	`netReceivableMinor` decimal(18,0) NOT NULL,
	`reviewReason` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `client_bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_bills_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `client_bill_org_number_uq` UNIQUE(`organizationId`,`billNumber`)
);
--> statement-breakpoint
CREATE TABLE `client_receipts` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`billId` varchar(36) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`receivedOn` date NOT NULL,
	`mode` varchar(32) NOT NULL,
	`reference` varchar(120),
	`status` enum('Recorded','Reversed') NOT NULL DEFAULT 'Recorded',
	`reversalReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `client_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `client_receipts_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `contract_items` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`itemCode` varchar(40) NOT NULL,
	`description` varchar(500) NOT NULL,
	`unit` varchar(20) NOT NULL,
	`contractQuantityThousandths` decimal(18,0) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`status` enum('Active','Removed') NOT NULL DEFAULT 'Active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contract_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `contract_item_project_code_uq` UNIQUE(`projectId`,`itemCode`)
);
--> statement-breakpoint
CREATE TABLE `crm_activities` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`leadId` varchar(36) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`note` text NOT NULL,
	`stageFrom` varchar(32),
	`stageTo` varchar(32),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crm_activities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_clients` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`name` varchar(180) NOT NULL,
	`clientType` varchar(40) NOT NULL,
	`contactPerson` varchar(120),
	`phone` varchar(20),
	`email` varchar(254),
	`gstin` varchar(15),
	`address` text,
	`status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crm_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_clients_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `crm_leads` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`clientId` varchar(36),
	`title` varchar(180) NOT NULL,
	`contactName` varchar(120),
	`phone` varchar(20),
	`location` varchar(180),
	`source` varchar(40) NOT NULL,
	`stage` varchar(32) NOT NULL,
	`estimatedValueMinor` decimal(18,0),
	`ownerUserId` int,
	`nextFollowUpOn` date,
	`lostReason` text,
	`projectId` varchar(36),
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crm_leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_leads_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `project_contracts` (
	`projectId` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`clientId` varchar(36) NOT NULL,
	`contractNumber` varchar(80),
	`quotationId` varchar(36),
	`gstBps` int NOT NULL,
	`retentionBps` int NOT NULL,
	`tdsBps` int NOT NULL,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_contracts_projectId` PRIMARY KEY(`projectId`)
);
--> statement-breakpoint
CREATE TABLE `quotation_lines` (
	`id` varchar(36) NOT NULL,
	`quotationId` varchar(36) NOT NULL,
	`lineNumber` int NOT NULL,
	`itemCode` varchar(40),
	`description` varchar(500) NOT NULL,
	`unit` varchar(20) NOT NULL,
	`quantityThousandths` decimal(18,0) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	CONSTRAINT `quotation_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`clientId` varchar(36) NOT NULL,
	`leadId` varchar(36),
	`quotationNumber` varchar(40) NOT NULL,
	`title` varchar(180) NOT NULL,
	`status` enum('Draft','Sent','Accepted','Rejected','Expired') NOT NULL DEFAULT 'Draft',
	`quotationDate` date NOT NULL,
	`validUntil` date,
	`gstBps` int NOT NULL,
	`subtotalMinor` decimal(18,0) NOT NULL,
	`gstMinor` decimal(18,0) NOT NULL,
	`totalMinor` decimal(18,0) NOT NULL,
	`terms` text,
	`projectId` varchar(36),
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quotations_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotations_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `quotation_org_number_uq` UNIQUE(`organizationId`,`quotationNumber`)
);
--> statement-breakpoint
ALTER TABLE `client_bill_lines` ADD CONSTRAINT `client_bill_lines_billId_client_bills_id_fk` FOREIGN KEY (`billId`) REFERENCES `client_bills`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_bill_lines` ADD CONSTRAINT `client_bill_lines_contractItemId_contract_items_id_fk` FOREIGN KEY (`contractItemId`) REFERENCES `contract_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_bills` ADD CONSTRAINT `client_bills_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_bills` ADD CONSTRAINT `client_bills_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_bills` ADD CONSTRAINT `client_bills_clientId_crm_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `crm_clients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_bills` ADD CONSTRAINT `client_bills_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_bills` ADD CONSTRAINT `client_bills_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_receipts` ADD CONSTRAINT `client_receipts_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_receipts` ADD CONSTRAINT `client_receipts_billId_client_bills_id_fk` FOREIGN KEY (`billId`) REFERENCES `client_bills`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `client_receipts` ADD CONSTRAINT `client_receipts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_items` ADD CONSTRAINT `contract_items_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_items` ADD CONSTRAINT `contract_items_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contract_items` ADD CONSTRAINT `contract_items_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_activities` ADD CONSTRAINT `crm_activities_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_activities` ADD CONSTRAINT `crm_activities_leadId_crm_leads_id_fk` FOREIGN KEY (`leadId`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_activities` ADD CONSTRAINT `crm_activities_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_clients` ADD CONSTRAINT `crm_clients_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_clients` ADD CONSTRAINT `crm_clients_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_clientId_crm_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `crm_clients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_contracts` ADD CONSTRAINT `project_contracts_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_contracts` ADD CONSTRAINT `project_contracts_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_contracts` ADD CONSTRAINT `project_contracts_clientId_crm_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `crm_clients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_contracts` ADD CONSTRAINT `project_contracts_quotationId_quotations_id_fk` FOREIGN KEY (`quotationId`) REFERENCES `quotations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_contracts` ADD CONSTRAINT `project_contracts_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotation_lines` ADD CONSTRAINT `quotation_lines_quotationId_quotations_id_fk` FOREIGN KEY (`quotationId`) REFERENCES `quotations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_clientId_crm_clients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `crm_clients`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_leadId_crm_leads_id_fk` FOREIGN KEY (`leadId`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `client_bill_project_idx` ON `client_bills` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `crm_activity_lead_idx` ON `crm_activities` (`leadId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `crm_client_org_idx` ON `crm_clients` (`organizationId`,`name`);--> statement-breakpoint
CREATE INDEX `crm_lead_org_stage_idx` ON `crm_leads` (`organizationId`,`stage`);