CREATE TABLE `person_details` (
	`personId` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`addressLine` varchar(300),
	`city` varchar(120),
	`district` varchar(120),
	`pincode` varchar(10),
	`alternatePhone` varchar(40),
	`vendorId` varchar(36),
	`notes` text,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `person_details_personId` PRIMARY KEY(`personId`)
);
--> statement-breakpoint
CREATE TABLE `person_feedback` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`kind` enum('Quality','Default','Safety','Praise','Payment dispute') NOT NULL,
	`rating` int,
	`note` text NOT NULL,
	`recordedBy` int NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `person_feedback_id` PRIMARY KEY(`id`),
	CONSTRAINT `person_feedback_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `person_details` ADD CONSTRAINT `person_details_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_details` ADD CONSTRAINT `person_details_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_details` ADD CONSTRAINT `person_details_vendorId_vendors_id_fk` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_details` ADD CONSTRAINT `person_details_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_feedback` ADD CONSTRAINT `person_feedback_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_feedback` ADD CONSTRAINT `person_feedback_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_feedback` ADD CONSTRAINT `person_feedback_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `person_feedback` ADD CONSTRAINT `person_feedback_recordedBy_users_id_fk` FOREIGN KEY (`recordedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `person_feedback_person_idx` ON `person_feedback` (`personId`,`createdAt`);