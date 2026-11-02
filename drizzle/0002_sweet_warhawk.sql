CREATE TABLE `task_dependencies` (
	`id` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`predecessorTaskId` varchar(36) NOT NULL,
	`successorTaskId` varchar(36) NOT NULL,
	`dependencyType` enum('Finish-to-Start') NOT NULL DEFAULT 'Finish-to-Start',
	`lagDays` int NOT NULL DEFAULT 0,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_dependencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `task_dependency_edge_uq` UNIQUE(`predecessorTaskId`,`successorTaskId`),
	CONSTRAINT `task_dependency_not_self_chk` CHECK(`task_dependencies`.`predecessorTaskId` <> `task_dependencies`.`successorTaskId`),
	CONSTRAINT `task_dependency_lag_nonnegative_chk` CHECK(`task_dependencies`.`lagDays` >= 0)
);
--> statement-breakpoint
CREATE TABLE `task_schedule_changes` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`selectedTaskId` varchar(36) NOT NULL,
	`changeType` enum('Initial Plan','Reschedule') NOT NULL,
	`strategy` enum('selected_only','shift_dependents') NOT NULL,
	`reasonCode` varchar(64) NOT NULL,
	`reasonText` text,
	`impactSummary` text NOT NULL,
	`status` enum('Applied') NOT NULL DEFAULT 'Applied',
	`requestedBy` int NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_schedule_changes_id` PRIMARY KEY(`id`),
	CONSTRAINT `task_schedule_changes_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `task_schedule_revisions` (
	`id` varchar(36) NOT NULL,
	`changeId` varchar(36) NOT NULL,
	`taskId` varchar(36) NOT NULL,
	`revisionNumber` int NOT NULL,
	`oldStart` date,
	`oldEnd` date,
	`newStart` date NOT NULL,
	`newEnd` date NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_schedule_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `task_schedule_revision_task_number_uq` UNIQUE(`taskId`,`revisionNumber`)
);
--> statement-breakpoint
CREATE TABLE `work_tasks` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`taskCode` varchar(32) NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text,
	`workCategory` varchar(80),
	`locationLabel` varchar(180),
	`plannedStart` date NOT NULL,
	`plannedEnd` date NOT NULL,
	`priority` enum('Low','Normal','High','Critical') NOT NULL DEFAULT 'Normal',
	`status` enum('Planned','Ready','In Progress','On Hold','Completed','Cancelled','Blocked','Awaiting Inspection') NOT NULL DEFAULT 'Planned',
	`holdReason` text,
	`scheduleRevision` int NOT NULL DEFAULT 1,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `work_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_tasks_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `work_task_site_code_uq` UNIQUE(`siteId`,`taskCode`)
);
--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_predecessorTaskId_work_tasks_id_fk` FOREIGN KEY (`predecessorTaskId`) REFERENCES `work_tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_successorTaskId_work_tasks_id_fk` FOREIGN KEY (`successorTaskId`) REFERENCES `work_tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependencies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_changes_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_changes_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_changes_selectedTaskId_work_tasks_id_fk` FOREIGN KEY (`selectedTaskId`) REFERENCES `work_tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_changes_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_revisions` ADD CONSTRAINT `task_schedule_revisions_changeId_task_schedule_changes_id_fk` FOREIGN KEY (`changeId`) REFERENCES `task_schedule_changes`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_revisions` ADD CONSTRAINT `task_schedule_revisions_taskId_work_tasks_id_fk` FOREIGN KEY (`taskId`) REFERENCES `work_tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_tasks_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_tasks_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_tasks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `task_dependency_site_successor_idx` ON `task_dependencies` (`siteId`,`successorTaskId`);--> statement-breakpoint
CREATE INDEX `task_schedule_change_site_time_idx` ON `task_schedule_changes` (`siteId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `task_schedule_change_task_idx` ON `task_schedule_changes` (`selectedTaskId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `task_schedule_revision_change_idx` ON `task_schedule_revisions` (`changeId`);--> statement-breakpoint
CREATE INDEX `work_task_site_dates_idx` ON `work_tasks` (`siteId`,`plannedStart`,`plannedEnd`);--> statement-breakpoint
CREATE INDEX `work_task_site_status_idx` ON `work_tasks` (`siteId`,`status`);