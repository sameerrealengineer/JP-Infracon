CREATE TABLE `attachment_locations` (
	`attachmentId` varchar(36) NOT NULL,
	`latitude` decimal(9,6) NOT NULL,
	`longitude` decimal(9,6) NOT NULL,
	`accuracyM` int,
	`distanceFromSiteM` int,
	`capturedAt` timestamp NOT NULL,
	CONSTRAINT `attachment_locations_attachmentId` PRIMARY KEY(`attachmentId`)
);
--> statement-breakpoint
CREATE TABLE `delegation_grants` (
	`delegationId` varchar(36) NOT NULL,
	`grantId` varchar(36) NOT NULL,
	CONSTRAINT `delegation_grant_uq` UNIQUE(`delegationId`,`grantId`)
);
--> statement-breakpoint
CREATE TABLE `delegations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`scopeType` enum('project','site') NOT NULL,
	`scopeId` varchar(36) NOT NULL,
	`bundles` varchar(120) NOT NULL,
	`reason` text NOT NULL,
	`effectiveFrom` timestamp NOT NULL,
	`effectiveTo` timestamp,
	`status` enum('Active','Revoked') NOT NULL DEFAULT 'Active',
	`grantedBy` int NOT NULL,
	`revokedBy` int,
	`revokedAt` timestamp,
	`revokeReason` text,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `delegations_id` PRIMARY KEY(`id`),
	CONSTRAINT `delegations_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36),
	`userId` int NOT NULL,
	`channel` enum('push','whatsapp','sms') NOT NULL,
	`eventKind` varchar(64) NOT NULL,
	`status` enum('Sent','Failed','Skipped') NOT NULL,
	`detail` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_devices` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`expoPushToken` varchar(255) NOT NULL,
	`platform` varchar(16) NOT NULL,
	`status` enum('Active','Disabled') NOT NULL DEFAULT 'Active',
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `push_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_devices_expoPushToken_unique` UNIQUE(`expoPushToken`)
);
--> statement-breakpoint
CREATE TABLE `registration_invites` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`codeHash` varchar(64) NOT NULL,
	`codeHint` varchar(8) NOT NULL,
	`inviteeName` varchar(120) NOT NULL,
	`businessRole` enum('director','admin','project_manager','supervisor','accounts','storekeeper','auditor') NOT NULL,
	`siteId` varchar(36),
	`status` enum('Active','Used','Revoked') NOT NULL DEFAULT 'Active',
	`expiresAt` timestamp NOT NULL,
	`createdBy` int NOT NULL,
	`usedBy` int,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `registration_invites_id` PRIMARY KEY(`id`),
	CONSTRAINT `registration_invites_codeHash_unique` UNIQUE(`codeHash`)
);
--> statement-breakpoint
CREATE TABLE `site_geofences` (
	`siteId` varchar(36) NOT NULL,
	`latitude` decimal(9,6) NOT NULL,
	`longitude` decimal(9,6) NOT NULL,
	`radiusM` int NOT NULL,
	`setBy` int NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_geofences_siteId` PRIMARY KEY(`siteId`)
);
--> statement-breakpoint
CREATE TABLE `site_presence_events` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`eventType` enum('Arrived','Left') NOT NULL,
	`latitude` decimal(9,6),
	`longitude` decimal(9,6),
	`accuracyM` int,
	`occurredAt` timestamp NOT NULL,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_presence_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_presence_events_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `user_contact_preferences` (
	`userId` int NOT NULL,
	`phone` varchar(20),
	`whatsappOptIn` enum('No','Yes') NOT NULL DEFAULT 'No',
	`smsOptIn` enum('No','Yes') NOT NULL DEFAULT 'No',
	`pushOptIn` enum('No','Yes') NOT NULL DEFAULT 'Yes',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_contact_preferences_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `attachment_locations` ADD CONSTRAINT `attachment_locations_attachmentId_attachments_id_fk` FOREIGN KEY (`attachmentId`) REFERENCES `attachments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delegation_grants` ADD CONSTRAINT `delegation_grants_delegationId_delegations_id_fk` FOREIGN KEY (`delegationId`) REFERENCES `delegations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delegation_grants` ADD CONSTRAINT `delegation_grants_grantId_permission_grants_id_fk` FOREIGN KEY (`grantId`) REFERENCES `permission_grants`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delegations` ADD CONSTRAINT `delegations_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delegations` ADD CONSTRAINT `delegations_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delegations` ADD CONSTRAINT `delegations_grantedBy_users_id_fk` FOREIGN KEY (`grantedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `delegations` ADD CONSTRAINT `delegations_revokedBy_users_id_fk` FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD CONSTRAINT `notification_deliveries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_devices` ADD CONSTRAINT `push_devices_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration_invites` ADD CONSTRAINT `registration_invites_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration_invites` ADD CONSTRAINT `registration_invites_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration_invites` ADD CONSTRAINT `registration_invites_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `registration_invites` ADD CONSTRAINT `registration_invites_usedBy_users_id_fk` FOREIGN KEY (`usedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_geofences` ADD CONSTRAINT `site_geofences_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_geofences` ADD CONSTRAINT `site_geofences_setBy_users_id_fk` FOREIGN KEY (`setBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_presence_events` ADD CONSTRAINT `site_presence_events_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_presence_events` ADD CONSTRAINT `site_presence_events_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_contact_preferences` ADD CONSTRAINT `user_contact_preferences_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `delegation_org_status_idx` ON `delegations` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `delegation_user_idx` ON `delegations` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `notification_delivery_user_time_idx` ON `notification_deliveries` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `push_device_user_idx` ON `push_devices` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `registration_invite_org_status_idx` ON `registration_invites` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `site_presence_site_time_idx` ON `site_presence_events` (`siteId`,`occurredAt`);