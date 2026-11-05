CREATE TABLE `goods_receipt_lines` (
	`id` varchar(36) NOT NULL,
	`goodsReceiptId` varchar(36) NOT NULL,
	`purchaseOrderLineId` varchar(36) NOT NULL,
	`acceptedThousandths` decimal(18,0) NOT NULL,
	`rejectedThousandths` decimal(18,0) NOT NULL,
	`rejectReason` varchar(300),
	`inventoryMovementId` varchar(36),
	CONSTRAINT `goods_receipt_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `goods_receipts` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`purchaseOrderId` varchar(36) NOT NULL,
	`grnNumber` varchar(40) NOT NULL,
	`receivedOn` date NOT NULL,
	`challanNumber` varchar(80),
	`vehicleNumber` varchar(40),
	`note` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `goods_receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `goods_receipts_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `grn_org_number_uq` UNIQUE(`organizationId`,`grnNumber`)
);
--> statement-breakpoint
CREATE TABLE `purchase_invoice_links` (
	`invoiceId` varchar(36) NOT NULL,
	`purchaseOrderId` varchar(36) NOT NULL,
	`linkedBy` int NOT NULL,
	`linkedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `purchase_invoice_links_invoiceId` PRIMARY KEY(`invoiceId`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` varchar(36) NOT NULL,
	`purchaseOrderId` varchar(36) NOT NULL,
	`lineNumber` int NOT NULL,
	`materialItemId` varchar(36),
	`description` varchar(300) NOT NULL,
	`unitCode` varchar(32) NOT NULL,
	`quantityThousandths` decimal(18,0) NOT NULL,
	`rateMinor` decimal(18,0) NOT NULL,
	`gstBps` int NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	CONSTRAINT `purchase_order_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_order_quotes` (
	`id` varchar(36) NOT NULL,
	`purchaseOrderId` varchar(36) NOT NULL,
	`vendorId` varchar(36),
	`vendorName` varchar(180) NOT NULL,
	`totalMinor` decimal(18,0) NOT NULL,
	`deliveryDays` int,
	`note` varchar(300),
	`chosen` enum('Yes','No') NOT NULL DEFAULT 'No',
	CONSTRAINT `purchase_order_quotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`vendorId` varchar(36) NOT NULL,
	`materialRequestId` varchar(36),
	`poNumber` varchar(40) NOT NULL,
	`status` enum('Draft','Submitted','Approved','Rejected','Cancelled','Closed') NOT NULL DEFAULT 'Draft',
	`orderDate` date NOT NULL,
	`expectedDate` date,
	`deliveryAddress` text,
	`terms` text,
	`subtotalMinor` decimal(18,0) NOT NULL,
	`gstMinor` decimal(18,0) NOT NULL,
	`totalMinor` decimal(18,0) NOT NULL,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `purchase_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `purchase_orders_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `po_org_number_uq` UNIQUE(`organizationId`,`poNumber`)
);
--> statement-breakpoint
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `goods_receipt_lines_goodsReceiptId_goods_receipts_id_fk` FOREIGN KEY (`goodsReceiptId`) REFERENCES `goods_receipts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipt_lines` ADD CONSTRAINT `grn_line_po_line_fk` FOREIGN KEY (`purchaseOrderLineId`) REFERENCES `purchase_order_lines`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_purchaseOrderId_purchase_orders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_invoice_links` ADD CONSTRAINT `purchase_invoice_links_invoiceId_supplier_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `supplier_invoices`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_invoice_links` ADD CONSTRAINT `purchase_invoice_links_purchaseOrderId_purchase_orders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_invoice_links` ADD CONSTRAINT `purchase_invoice_links_linkedBy_users_id_fk` FOREIGN KEY (`linkedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_purchaseOrderId_purchase_orders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_materialItemId_material_items_id_fk` FOREIGN KEY (`materialItemId`) REFERENCES `material_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_quotes` ADD CONSTRAINT `purchase_order_quotes_purchaseOrderId_purchase_orders_id_fk` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_order_quotes` ADD CONSTRAINT `purchase_order_quotes_vendorId_vendors_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_vendorId_vendors_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_materialRequestId_material_requests_id_fk` FOREIGN KEY (`materialRequestId`) REFERENCES `material_requests`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `grn_po_idx` ON `goods_receipts` (`purchaseOrderId`);--> statement-breakpoint
CREATE INDEX `po_site_status_idx` ON `purchase_orders` (`siteId`,`status`);