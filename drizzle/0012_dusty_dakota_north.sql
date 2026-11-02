CREATE TABLE `site_issue_events` (
	`id` varchar(36) NOT NULL,
	`issueId` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`eventType` enum('Raised','Comment','Assigned','Status Changed','Reopened') NOT NULL,
	`fromStatus` varchar(32),
	`toStatus` varchar(32),
	`note` text,
	`actorUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_issue_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `site_issues` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`issueCode` varchar(48) NOT NULL,
	`category` enum('Safety Hazard','Incident','Near Miss','Quality Defect','Quality Observation','Material Shortage','Drawing / Approval','Utility / Access','Equipment Breakdown','Client Coordination','Other') NOT NULL,
	`severity` enum('Low','Medium','High','Critical') NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`locationLabel` varchar(180),
	`immediateAction` text,
	`stopWork` enum('No','Yes') NOT NULL DEFAULT 'No',
	`observedAt` timestamp NOT NULL,
	`status` enum('Open','In Progress','Resolved','Closed') NOT NULL DEFAULT 'Open',
	`ownerUserId` int,
	`ownerNameSnapshot` varchar(180),
	`targetDate` date,
	`correctiveAction` text,
	`preventiveAction` text,
	`closureNote` text,
	`raisedBy` int NOT NULL,
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`closedBy` int,
	`closedAt` timestamp,
	`reopenCount` int NOT NULL DEFAULT 0,
	`recordVersion` int NOT NULL DEFAULT 1,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_issues_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_issues_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `site_issue_org_code_uq` UNIQUE(`organizationId`,`issueCode`)
);
--> statement-breakpoint
ALTER TABLE `site_issue_events` ADD CONSTRAINT `site_issue_events_issueId_site_issues_id_fk` FOREIGN KEY (`issueId`) REFERENCES `site_issues`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issue_events` ADD CONSTRAINT `site_issue_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issues` ADD CONSTRAINT `site_issues_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issues` ADD CONSTRAINT `site_issues_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issues` ADD CONSTRAINT `site_issues_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issues` ADD CONSTRAINT `site_issues_raisedBy_users_id_fk` FOREIGN KEY (`raisedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issues` ADD CONSTRAINT `site_issues_resolvedBy_users_id_fk` FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_issues` ADD CONSTRAINT `site_issues_closedBy_users_id_fk` FOREIGN KEY (`closedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `site_issue_event_issue_idx` ON `site_issue_events` (`issueId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `site_issue_site_status_idx` ON `site_issues` (`siteId`,`status`,`severity`);--> statement-breakpoint
CREATE INDEX `site_issue_owner_idx` ON `site_issues` (`ownerUserId`,`status`);