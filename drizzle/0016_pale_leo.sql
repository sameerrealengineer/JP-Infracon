CREATE TABLE `project_budget_lines` (
	`id` varchar(36) NOT NULL,
	`budgetId` varchar(36) NOT NULL,
	`costHead` varchar(64) NOT NULL,
	`amountMinor` decimal(18,0) NOT NULL,
	`note` varchar(300),
	CONSTRAINT `project_budget_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_budget_line_head_uq` UNIQUE(`budgetId`,`costHead`)
);
--> statement-breakpoint
CREATE TABLE `project_budgets` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`revisionNumber` int NOT NULL,
	`status` enum('Proposed','Approved','Rejected','Superseded') NOT NULL DEFAULT 'Proposed',
	`contractValueMinor` decimal(18,0),
	`totalMinor` decimal(18,0) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`reason` text,
	`proposedBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_budgets_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_budgets_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `project_budget_revision_uq` UNIQUE(`projectId`,`revisionNumber`)
);
--> statement-breakpoint
ALTER TABLE `project_budget_lines` ADD CONSTRAINT `project_budget_lines_budgetId_project_budgets_id_fk` FOREIGN KEY (`budgetId`) REFERENCES `project_budgets`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_budgets` ADD CONSTRAINT `project_budgets_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_budgets` ADD CONSTRAINT `project_budgets_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_budgets` ADD CONSTRAINT `project_budgets_proposedBy_users_id_fk` FOREIGN KEY (`proposedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_budgets` ADD CONSTRAINT `project_budgets_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `project_budget_project_status_idx` ON `project_budgets` (`projectId`,`status`);