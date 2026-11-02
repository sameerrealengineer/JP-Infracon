CREATE TABLE `supplier_invoice_lines` (
	`id` varchar(36) NOT NULL,
	`invoiceId` varchar(36) NOT NULL,
	`description` varchar(240) NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`unitCode` varchar(32) NOT NULL,
	`lineTotalMinor` decimal(18,0) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplier_invoice_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_invoices` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`vendorId` varchar(36) NOT NULL,
	`invoiceNumber` varchar(80) NOT NULL,
	`invoiceNumberKey` varchar(80) NOT NULL,
	`invoiceDate` date NOT NULL,
	`dueDate` date,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`subtotalMinor` decimal(18,0) NOT NULL,
	`taxMinor` decimal(18,0) NOT NULL,
	`chargesMinor` decimal(18,0) NOT NULL,
	`totalMinor` decimal(18,0) NOT NULL,
	`purchaseReference` varchar(120),
	`receiptReference` varchar(120),
	`status` enum('Draft','Submitted','Approved','Rejected','Disputed') NOT NULL DEFAULT 'Draft',
	`createdBy` int NOT NULL,
	`submittedBy` int,
	`submittedAt` timestamp,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supplier_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_invoices_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `supplier_invoice_org_id_uq` UNIQUE(`organizationId`,`id`),
	CONSTRAINT `supplier_invoice_vendor_number_uq` UNIQUE(`organizationId`,`vendorId`,`invoiceNumberKey`)
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`vendorType` enum('Material Supplier','Transporter','Subcontractor','Service Provider','Other') NOT NULL DEFAULT 'Other',
	`legalName` varchar(180) NOT NULL,
	`tradeName` varchar(180),
	`contactName` varchar(120),
	`phone` varchar(40),
	`email` varchar(254),
	`address` text,
	`paymentTermsDays` int,
	`status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vendors_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendors_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `vendor_org_id_uq` UNIQUE(`organizationId`,`id`)
);
--> statement-breakpoint
ALTER TABLE `supplier_invoice_lines` ADD CONSTRAINT `supplier_invoice_lines_invoiceId_supplier_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `supplier_invoices`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoices_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoices_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoices_submittedBy_users_id_fk` FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoices_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoice_site_same_org_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoice_vendor_same_org_fk` FOREIGN KEY (`organizationId`,`vendorId`) REFERENCES `vendors`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendors` ADD CONSTRAINT `vendors_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `vendors` ADD CONSTRAINT `vendors_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `supplier_invoice_line_parent_idx` ON `supplier_invoice_lines` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `supplier_invoice_site_status_idx` ON `supplier_invoices` (`organizationId`,`siteId`,`status`,`invoiceDate`);--> statement-breakpoint
CREATE INDEX `supplier_invoice_vendor_date_idx` ON `supplier_invoices` (`organizationId`,`vendorId`,`invoiceDate`);--> statement-breakpoint
CREATE INDEX `vendor_org_status_idx` ON `vendors` (`organizationId`,`status`,`legalName`);