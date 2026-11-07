CREATE TABLE `subcontract_bill_lines` (
	`id` varchar(36) NOT NULL,
	`billId` varchar(36) NOT NULL,
	`itemId` varchar(36) NOT NULL,
	`quantityThousandths` decimal(18,0) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	CONSTRAINT `subcontract_bill_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subcontract_bills` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`workOrderId` varchar(36) NOT NULL,
	`billNumber` varchar(60) NOT NULL,
	`billDate` date NOT NULL,
	`periodTo` date NOT NULL,
	`status` enum('Draft','Submitted','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Draft',
	`workValueMinor` decimal(18,0) NOT NULL,
	`gstMinor` decimal(18,0) NOT NULL,
	`retentionMinor` decimal(18,0) NOT NULL,
	`tdsMinor` decimal(18,0) NOT NULL,
	`advanceRecoveryMinor` decimal(18,0) NOT NULL,
	`otherDeductionMinor` decimal(18,0) NOT NULL,
	`otherDeductionNote` varchar(300),
	`netPayableMinor` decimal(18,0) NOT NULL,
	`invoiceId` varchar(36),
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subcontract_bills_id` PRIMARY KEY(`id`),
	CONSTRAINT `subcontract_bills_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `sub_bill_org_number_uq` UNIQUE(`organizationId`,`billNumber`)
);
--> statement-breakpoint
CREATE TABLE `work_measurements` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`workOrderId` varchar(36) NOT NULL,
	`itemId` varchar(36) NOT NULL,
	`measuredOn` date NOT NULL,
	`location` varchar(200) NOT NULL,
	`nos` varchar(20),
	`length` varchar(20),
	`breadth` varchar(20),
	`depth` varchar(20),
	`deduction` enum('Yes','No') NOT NULL DEFAULT 'No',
	`quantityThousandths` decimal(18,0) NOT NULL,
	`status` enum('Recorded','Checked','Rejected') NOT NULL DEFAULT 'Recorded',
	`checkedBy` int,
	`checkedAt` timestamp,
	`rejectReason` text,
	`billId` varchar(36),
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_measurements_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_measurements_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `work_order_items` (
	`id` varchar(36) NOT NULL,
	`workOrderId` varchar(36) NOT NULL,
	`lineNumber` int NOT NULL,
	`itemCode` varchar(40) NOT NULL,
	`description` varchar(500) NOT NULL,
	`unit` varchar(20) NOT NULL,
	`quantityThousandths` decimal(18,0) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	CONSTRAINT `work_order_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `wo_item_code_uq` UNIQUE(`workOrderId`,`itemCode`)
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`vendorId` varchar(36) NOT NULL,
	`woNumber` varchar(40) NOT NULL,
	`title` varchar(200) NOT NULL,
	`scope` text,
	`startDate` date NOT NULL,
	`endDate` date,
	`status` enum('Draft','Submitted','Approved','Rejected','Cancelled','Closed') NOT NULL DEFAULT 'Draft',
	`gstBps` int NOT NULL,
	`retentionBps` int NOT NULL,
	`tdsBps` int NOT NULL,
	`valueMinor` decimal(18,0) NOT NULL,
	`advanceMinor` decimal(18,0) NOT NULL,
	`advanceRecoveryBps` int NOT NULL,
	`advanceInvoiceId` varchar(36),
	`retentionReleasedMinor` decimal(18,0) NOT NULL,
	`retentionInvoiceId` varchar(36),
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `work_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_orders_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `wo_org_number_uq` UNIQUE(`organizationId`,`woNumber`)
);
--> statement-breakpoint
ALTER TABLE `subcontract_bill_lines` ADD CONSTRAINT `subcontract_bill_lines_billId_subcontract_bills_id_fk` FOREIGN KEY (`billId`) REFERENCES `subcontract_bills`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subcontract_bill_lines` ADD CONSTRAINT `subcontract_bill_lines_itemId_work_order_items_id_fk` FOREIGN KEY (`itemId`) REFERENCES `work_order_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subcontract_bills` ADD CONSTRAINT `subcontract_bills_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subcontract_bills` ADD CONSTRAINT `subcontract_bills_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subcontract_bills` ADD CONSTRAINT `subcontract_bills_workOrderId_work_orders_id_fk` FOREIGN KEY (`workOrderId`) REFERENCES `work_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subcontract_bills` ADD CONSTRAINT `subcontract_bills_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subcontract_bills` ADD CONSTRAINT `subcontract_bills_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_measurements` ADD CONSTRAINT `work_measurements_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_measurements` ADD CONSTRAINT `work_measurements_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_measurements` ADD CONSTRAINT `work_measurements_workOrderId_work_orders_id_fk` FOREIGN KEY (`workOrderId`) REFERENCES `work_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_measurements` ADD CONSTRAINT `work_measurements_itemId_work_order_items_id_fk` FOREIGN KEY (`itemId`) REFERENCES `work_order_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_measurements` ADD CONSTRAINT `work_measurements_checkedBy_users_id_fk` FOREIGN KEY (`checkedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_measurements` ADD CONSTRAINT `work_measurements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD CONSTRAINT `work_order_items_workOrderId_work_orders_id_fk` FOREIGN KEY (`workOrderId`) REFERENCES `work_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_vendorId_vendors_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sub_bill_wo_idx` ON `subcontract_bills` (`workOrderId`,`status`);--> statement-breakpoint
CREATE INDEX `measurement_wo_idx` ON `work_measurements` (`workOrderId`,`status`);--> statement-breakpoint
CREATE INDEX `measurement_site_idx` ON `work_measurements` (`siteId`,`status`);--> statement-breakpoint
CREATE INDEX `wo_site_status_idx` ON `work_orders` (`siteId`,`status`);--> statement-breakpoint
CREATE INDEX `wo_vendor_idx` ON `work_orders` (`vendorId`);