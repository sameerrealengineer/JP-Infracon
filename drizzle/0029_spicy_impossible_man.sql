CREATE TABLE `crew_deployments` (
	`id` varchar(36) NOT NULL,
	`crewId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`workDate` date NOT NULL,
	`taskId` varchar(36),
	`headcount` int NOT NULL,
	`note` varchar(300),
	`createdBy` int NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crew_deployments_id` PRIMARY KEY(`id`),
	CONSTRAINT `crew_deployments_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `crew_members` (
	`id` varchar(36) NOT NULL,
	`crewId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`joinedOn` date NOT NULL,
	`leftOn` date,
	`addedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crew_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crews` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`trade` varchar(80) NOT NULL,
	`status` enum('Active','Closed') NOT NULL DEFAULT 'Active',
	`createdBy` int NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crews_id` PRIMARY KEY(`id`),
	CONSTRAINT `crews_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `crew_site_name_uq` UNIQUE(`siteId`,`name`)
);
--> statement-breakpoint
ALTER TABLE `crew_deployments` ADD CONSTRAINT `crew_deployments_crewId_crews_id_fk` FOREIGN KEY (`crewId`) REFERENCES `crews`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crew_deployments` ADD CONSTRAINT `crew_deployments_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crew_deployments` ADD CONSTRAINT `crew_deployments_taskId_work_tasks_id_fk` FOREIGN KEY (`taskId`) REFERENCES `work_tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crew_deployments` ADD CONSTRAINT `crew_deployments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crew_members` ADD CONSTRAINT `crew_members_crewId_crews_id_fk` FOREIGN KEY (`crewId`) REFERENCES `crews`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crew_members` ADD CONSTRAINT `crew_members_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crew_members` ADD CONSTRAINT `crew_members_addedBy_users_id_fk` FOREIGN KEY (`addedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crews` ADD CONSTRAINT `crews_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crews` ADD CONSTRAINT `crews_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crews` ADD CONSTRAINT `crews_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `crew_deploy_site_date_idx` ON `crew_deployments` (`siteId`,`workDate`);--> statement-breakpoint
CREATE INDEX `crew_deploy_crew_date_idx` ON `crew_deployments` (`crewId`,`workDate`);--> statement-breakpoint
CREATE INDEX `crew_member_crew_idx` ON `crew_members` (`crewId`,`leftOn`);--> statement-breakpoint
CREATE INDEX `crew_member_person_idx` ON `crew_members` (`personId`,`leftOn`);--> statement-breakpoint
CREATE INDEX `crew_site_status_idx` ON `crews` (`siteId`,`status`);