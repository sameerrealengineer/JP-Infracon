CREATE TABLE `person_site_assignments` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`status` enum('Active','Revoked') NOT NULL DEFAULT 'Active',
	`assignedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `person_site_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `person_site_assignment_uq` UNIQUE(`personId`,`siteId`)
);
--> statement-breakpoint
ALTER TABLE `people` ADD `kycReviewedBy` int;--> statement-breakpoint
ALTER TABLE `people` ADD `kycReviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `people` ADD `kycReviewReason` text;--> statement-breakpoint
ALTER TABLE `people` ADD `clientMutationId` varchar(64);--> statement-breakpoint
UPDATE `people` SET `clientMutationId` = CONCAT('legacy-person-', `id`) WHERE `clientMutationId` IS NULL;--> statement-breakpoint
ALTER TABLE `people` MODIFY `clientMutationId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD `organizationId` varchar(36);--> statement-breakpoint
UPDATE `worker_engagements` AS `we` INNER JOIN `sites` AS `s` ON `s`.`id` = `we`.`siteId` SET `we`.`organizationId` = `s`.`organizationId` WHERE `we`.`organizationId` IS NULL;--> statement-breakpoint
ALTER TABLE `worker_engagements` MODIFY `organizationId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD `reviewReason` text;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD `createdBy` int;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD `clientMutationId` varchar(64);--> statement-breakpoint
UPDATE `worker_engagements` SET `clientMutationId` = CONCAT('legacy-rate-', `id`) WHERE `clientMutationId` IS NULL;--> statement-breakpoint
ALTER TABLE `worker_engagements` MODIFY `clientMutationId` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD CONSTRAINT `people_clientMutationId_unique` UNIQUE(`clientMutationId`);--> statement-breakpoint
ALTER TABLE `people` ADD CONSTRAINT `people_org_id_uq` UNIQUE(`organizationId`,`id`);--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagements_clientMutationId_unique` UNIQUE(`clientMutationId`);--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagement_site_id_uq` UNIQUE(`siteId`,`id`);--> statement-breakpoint
ALTER TABLE `person_site_assignments` ADD CONSTRAINT `person_site_assignments_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_site_assignments` ADD CONSTRAINT `person_site_assignments_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_site_assignments` ADD CONSTRAINT `person_site_assignments_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_site_assignments` ADD CONSTRAINT `person_site_assignments_assignedBy_users_id_fk` FOREIGN KEY (`assignedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_site_assignments` ADD CONSTRAINT `person_site_person_same_org_fk` FOREIGN KEY (`organizationId`,`personId`) REFERENCES `people`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_site_assignments` ADD CONSTRAINT `person_site_site_same_org_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `person_site_status_idx` ON `person_site_assignments` (`siteId`,`status`,`personId`);--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagement_rate_positive_chk` CHECK (`worker_engagements`.`rateMinor` > 0);--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagement_effective_range_chk` CHECK (`worker_engagements`.`effectiveTo` is null or `worker_engagements`.`effectiveTo` >= `worker_engagements`.`effectiveFrom`);--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_engagement_same_site_fk` FOREIGN KEY (`siteId`,`workerEngagementId`) REFERENCES `worker_engagements`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `people` ADD CONSTRAINT `people_kycReviewedBy_users_id_fk` FOREIGN KEY (`kycReviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagements_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagement_person_same_org_fk` FOREIGN KEY (`organizationId`,`personId`) REFERENCES `people`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagement_site_same_org_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `engagement_person_rate_idx` ON `worker_engagements` (`siteId`,`personId`,`engagementType`,`effectiveFrom`);
