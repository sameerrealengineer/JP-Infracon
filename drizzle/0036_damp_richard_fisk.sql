CREATE TABLE `approval_limits` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`role` varchar(64) NOT NULL,
	`area` enum('purchase_order','subcontract_bill','supplier_payment','petty_cash','client_bill','budget') NOT NULL,
	`limitMinor` decimal(18,0) NOT NULL,
	`updatedBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `approval_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `approval_limit_role_area_uq` UNIQUE(`organizationId`,`role`,`area`)
);
--> statement-breakpoint
CREATE TABLE `project_assignments` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` varchar(64) NOT NULL,
	`status` enum('Active','Revoked') NOT NULL DEFAULT 'Active',
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`effectiveTo` timestamp,
	`assignedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `approval_limits` ADD CONSTRAINT `approval_limits_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `approval_limits` ADD CONSTRAINT `approval_limits_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_assignments` ADD CONSTRAINT `project_assignments_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_assignments` ADD CONSTRAINT `project_assignments_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_assignments` ADD CONSTRAINT `project_assignments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_assignments` ADD CONSTRAINT `project_assignments_assignedBy_users_id_fk` FOREIGN KEY (`assignedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `project_assign_user_idx` ON `project_assignments` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `project_assign_project_idx` ON `project_assignments` (`projectId`,`status`);