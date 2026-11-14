CREATE TABLE `leave_requests` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`applicantUserId` int,
	`personId` varchar(36),
	`leaveType` enum('Casual','Sick','Earned','Unpaid','Other') NOT NULL,
	`fromDate` date NOT NULL,
	`toDate` date NOT NULL,
	`halfDays` int NOT NULL,
	`reason` text NOT NULL,
	`status` enum('Pending','Approved','Rejected','Cancelled') NOT NULL DEFAULT 'Pending',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`createdBy` int NOT NULL,
	`clientMutationId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leave_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_return_lines` (
	`id` varchar(36) NOT NULL,
	`returnId` varchar(36) NOT NULL,
	`materialItemId` varchar(36),
	`description` varchar(240) NOT NULL,
	`unitCode` varchar(32) NOT NULL,
	`quantity` decimal(14,3) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`movementId` varchar(36),
	CONSTRAINT `purchase_return_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_returns` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`vendorId` varchar(36) NOT NULL,
	`purchaseOrderId` varchar(36),
	`returnNumber` varchar(40) NOT NULL,
	`returnDate` date NOT NULL,
	`reason` text NOT NULL,
	`totalMinor` decimal(18,0) NOT NULL,
	`status` enum('Submitted','Approved','Rejected','Settled','Cancelled') NOT NULL DEFAULT 'Submitted',
	`settlement` enum('Refund','Credit note','Replacement'),
	`settledMinor` decimal(18,0),
	`settlementReference` varchar(120),
	`settledOn` date,
	`settledBy` int,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`createdBy` int NOT NULL,
	`clientMutationId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_returns_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_returns_returnNumber_unique` UNIQUE(`returnNumber`)
);
--> statement-breakpoint
ALTER TABLE `inventory_movements` MODIFY COLUMN `movementType` enum('Receipt/Inward','Issue/Consumption','Return to Store','Wastage','Damage','Return to Supplier') NOT NULL;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_applicantUserId_users_id_fk` FOREIGN KEY (`applicantUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_return_lines` ADD CONSTRAINT `purchase_return_lines_returnId_purchase_returns_id_fk` FOREIGN KEY (`returnId`) REFERENCES `purchase_returns`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_return_lines` ADD CONSTRAINT `purchase_return_lines_materialItemId_material_items_id_fk` FOREIGN KEY (`materialItemId`) REFERENCES `material_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_vendorId_vendors_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_purchaseOrderId_purchase_orders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_settledBy_users_id_fk` FOREIGN KEY (`settledBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_returns` ADD CONSTRAINT `purchase_returns_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `leave_site_status_idx` ON `leave_requests` (`siteId`,`status`);--> statement-breakpoint
CREATE INDEX `leave_applicant_idx` ON `leave_requests` (`applicantUserId`,`fromDate`);--> statement-breakpoint
CREATE INDEX `preturn_site_status_idx` ON `purchase_returns` (`siteId`,`status`);