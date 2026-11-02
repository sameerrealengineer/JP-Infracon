CREATE TABLE `supplier_payment_allocations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`vendorId` varchar(36) NOT NULL,
	`paymentId` varchar(36) NOT NULL,
	`invoiceId` varchar(36) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplier_payment_allocations_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_payment_invoice_allocation_uq` UNIQUE(`paymentId`,`invoiceId`)
);
--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`vendorId` varchar(36) NOT NULL,
	`transactionType` enum('Supplier Invoice Payment','Supplier Advance','Transporter Freight','Supplier Refund','Other') NOT NULL DEFAULT 'Supplier Invoice Payment',
	`direction` enum('Outflow','Inflow') NOT NULL DEFAULT 'Outflow',
	`amountMinor` decimal(18,0) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`paymentDate` date NOT NULL,
	`paymentMode` enum('Bank Transfer','UPI','Cheque','Cash','Other') NOT NULL,
	`beneficiaryNameSnapshot` varchar(180) NOT NULL,
	`paidByName` varchar(180) NOT NULL,
	`fundingSourceLabel` varchar(180) NOT NULL,
	`category` varchar(80) NOT NULL,
	`purpose` varchar(500) NOT NULL,
	`externalReference` varchar(120),
	`status` enum('Draft','Submitted','Approved','Rejected','Cancelled','Posted','Reversed') NOT NULL DEFAULT 'Draft',
	`createdBy` int NOT NULL,
	`submittedBy` int,
	`submittedAt` timestamp,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`postedBy` int,
	`postedAt` timestamp,
	`cancelledBy` int,
	`cancelledAt` timestamp,
	`cancellationReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supplier_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_payments_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `supplier_payment_org_id_uq` UNIQUE(`organizationId`,`id`),
	CONSTRAINT `supplier_payment_scope_vendor_id_uq` UNIQUE(`organizationId`,`siteId`,`vendorId`,`id`)
);
--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD CONSTRAINT `supplier_invoice_payment_scope_uq` UNIQUE(`organizationId`,`siteId`,`vendorId`,`id`);--> statement-breakpoint
ALTER TABLE `supplier_payment_allocations` ADD CONSTRAINT `supplier_payment_allocation_payment_scope_fk` FOREIGN KEY (`organizationId`,`siteId`,`vendorId`,`paymentId`) REFERENCES `supplier_payments`(`organizationId`,`siteId`,`vendorId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payment_allocations` ADD CONSTRAINT `supplier_payment_allocation_invoice_scope_fk` FOREIGN KEY (`organizationId`,`siteId`,`vendorId`,`invoiceId`) REFERENCES `supplier_invoices`(`organizationId`,`siteId`,`vendorId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_submittedBy_users_id_fk` FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_postedBy_users_id_fk` FOREIGN KEY (`postedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payments_cancelledBy_users_id_fk` FOREIGN KEY (`cancelledBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payment_site_same_org_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supplier_payments` ADD CONSTRAINT `supplier_payment_vendor_same_org_fk` FOREIGN KEY (`organizationId`,`vendorId`) REFERENCES `vendors`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `supplier_payment_allocation_payment_idx` ON `supplier_payment_allocations` (`organizationId`,`siteId`,`paymentId`);--> statement-breakpoint
CREATE INDEX `supplier_payment_allocation_invoice_idx` ON `supplier_payment_allocations` (`organizationId`,`siteId`,`invoiceId`);--> statement-breakpoint
CREATE INDEX `supplier_payment_site_status_idx` ON `supplier_payments` (`organizationId`,`siteId`,`status`,`paymentDate`);--> statement-breakpoint
CREATE INDEX `supplier_payment_vendor_date_idx` ON `supplier_payments` (`organizationId`,`vendorId`,`paymentDate`);