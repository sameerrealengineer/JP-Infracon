CREATE TABLE `attachments` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` varchar(36) NOT NULL,
	`storageKey` varchar(240) NOT NULL,
	`originalFilename` varchar(240) NOT NULL,
	`contentType` varchar(120) NOT NULL,
	`sizeBytes` int NOT NULL,
	`checksum` varchar(128),
	`uploadedBy` int NOT NULL,
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	`captureTime` timestamp,
	`sourceType` enum('Captured in app','Selected from device','Imported') NOT NULL,
	`accessClassification` enum('Private','Restricted') NOT NULL DEFAULT 'Private',
	`scanStatus` enum('Pending','Accepted','Rejected') NOT NULL DEFAULT 'Pending',
	CONSTRAINT `attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `attachments_storageKey_unique` UNIQUE(`storageKey`)
);
--> statement-breakpoint
CREATE TABLE `attendance_records` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`reportId` varchar(36),
	`workDate` date NOT NULL,
	`shiftCode` varchar(32) NOT NULL,
	`workerEngagementId` varchar(36) NOT NULL,
	`attendanceStatus` enum('Full Day','Half Day','Absent','Leave','Present-hours-based') NOT NULL,
	`regularHours` decimal(6,2) NOT NULL DEFAULT '0',
	`overtimeHours` decimal(6,2) NOT NULL DEFAULT '0',
	`overtimeApprovalStatus` enum('Not Applicable','Pending','Approved','Rejected') NOT NULL DEFAULT 'Not Applicable',
	`rateSnapshotMinor` int,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`markedBy` int NOT NULL,
	`reviewedBy` int,
	`correctionOfId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `attendance_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `attendance_engagement_site_date_shift_uq` UNIQUE(`workerEngagementId`,`siteId`,`workDate`,`shiftCode`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36),
	`actorUserId` int NOT NULL,
	`action` varchar(96) NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` varchar(36) NOT NULL,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`requestId` varchar(100),
	`beforeSummary` text,
	`afterSummary` text,
	`reason` text,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_report_items` (
	`id` varchar(36) NOT NULL,
	`dailyReportId` varchar(36) NOT NULL,
	`taskId` varchar(36),
	`workItemCode` varchar(80),
	`description` varchar(240) NOT NULL,
	`locationLabel` varchar(180),
	`plannedQuantity` decimal(14,3),
	`completedQuantityToday` decimal(14,3),
	`cumulativeQuantity` decimal(14,3),
	`unitCode` varchar(32),
	`estimatedPercent` decimal(5,2),
	`remarks` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_report_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_reports` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`reportKind` enum('DPR','DLR') NOT NULL,
	`reportDate` date NOT NULL,
	`shiftCode` varchar(32) NOT NULL DEFAULT 'General',
	`title` varchar(180) NOT NULL,
	`weatherCode` varchar(64),
	`overallStatus` varchar(64),
	`remarks` text,
	`nextDayPlan` text,
	`status` enum('Draft','Submitted','Under Review','Approved','Returned for Correction') NOT NULL DEFAULT 'Draft',
	`revisionNumber` int NOT NULL DEFAULT 1,
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`submittedAt` timestamp,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`returnReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `daily_reports_clientMutationId_unique` UNIQUE(`clientMutationId`),
	CONSTRAINT `daily_report_site_date_shift_revision_uq` UNIQUE(`siteId`,`reportDate`,`shiftCode`,`revisionNumber`)
);
--> statement-breakpoint
CREATE TABLE `material_items` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`itemCode` varchar(48) NOT NULL,
	`name` varchar(180) NOT NULL,
	`category` varchar(80),
	`specification` varchar(180),
	`baseUnitCode` varchar(32) NOT NULL,
	`reorderThreshold` decimal(14,3),
	`status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `material_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `material_item_org_code_uq` UNIQUE(`organizationId`,`itemCode`)
);
--> statement-breakpoint
CREATE TABLE `material_request_items` (
	`id` varchar(36) NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`materialItemId` varchar(36),
	`itemNameSnapshot` varchar(180) NOT NULL,
	`requestedQuantity` decimal(14,3) NOT NULL,
	`approvedQuantity` decimal(14,3),
	`unitCode` varchar(32) NOT NULL,
	`remarks` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `material_request_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `material_requests` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`requestedBy` int NOT NULL,
	`requiredBy` date,
	`purpose` text,
	`status` enum('Submitted','Approved','Partially Approved','Returned','Rejected','Cancelled') NOT NULL DEFAULT 'Submitted',
	`approvalNote` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`clientMutationId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `material_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `material_requests_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`businessRole` enum('owner','director','admin','project_manager','supervisor','accounts','storekeeper','auditor') NOT NULL,
	`status` enum('Invited','Active','Suspended','Deactivated') NOT NULL DEFAULT 'Active',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organization_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `org_member_role_uq` UNIQUE(`organizationId`,`userId`,`businessRole`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`code` varchar(32) NOT NULL,
	`status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`personType` enum('worker','technician','subcontractor_contact') NOT NULL DEFAULT 'worker',
	`fullName` varchar(180) NOT NULL,
	`phone` varchar(40),
	`skillCategory` enum('Skilled','Semi-skilled','Unskilled','Not specified') NOT NULL DEFAULT 'Not specified',
	`tradeType` varchar(80),
	`status` enum('Draft','Active','Inactive') NOT NULL DEFAULT 'Draft',
	`kycStatus` enum('Not Required','Pending','Verified by authorised reviewer','Rejected') NOT NULL DEFAULT 'Not Required',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `people_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permission_grants` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`scopeType` enum('organization','project','site') NOT NULL,
	`scopeId` varchar(36) NOT NULL,
	`permissionKey` varchar(96) NOT NULL,
	`effect` enum('allow','deny') NOT NULL,
	`maxAmountMinor` int,
	`dailyLimitMinor` int,
	`monthlyLimitMinor` int,
	`requiresEvidence` enum('yes','no') NOT NULL DEFAULT 'no',
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`effectiveTo` timestamp,
	`status` enum('Active','Revoked') NOT NULL DEFAULT 'Active',
	`grantedBy` int NOT NULL,
	`revokedBy` int,
	`revokedAt` timestamp,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `permission_grants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectCode` varchar(32) NOT NULL,
	`name` varchar(180) NOT NULL,
	`clientDepartment` varchar(180),
	`projectType` varchar(64),
	`startDate` date,
	`targetEndDate` date,
	`status` enum('Active','On Hold','Completed','Inactive') NOT NULL DEFAULT 'Active',
	`projectManagerUserId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_org_code_uq` UNIQUE(`organizationId`,`projectCode`)
);
--> statement-breakpoint
CREATE TABLE `site_assignments` (
	`id` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`assignmentRole` varchar(64) NOT NULL,
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`effectiveTo` timestamp,
	`status` enum('Active','Revoked') NOT NULL DEFAULT 'Active',
	`assignedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `site_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`siteCode` varchar(32) NOT NULL,
	`name` varchar(180) NOT NULL,
	`address` text,
	`village` varchar(120),
	`district` varchar(120),
	`state` varchar(120),
	`timeZone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`status` enum('Active','On Hold','Completed','Inactive') NOT NULL DEFAULT 'Active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_org_code_uq` UNIQUE(`organizationId`,`siteCode`)
);
--> statement-breakpoint
CREATE TABLE `worker_engagements` (
	`id` varchar(36) NOT NULL,
	`personId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`engagementType` varchar(64) NOT NULL,
	`rateType` enum('daily','hourly','shift','piece','per_connection','per_measurement','contract') NOT NULL,
	`rateMinor` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'INR',
	`effectiveFrom` date NOT NULL,
	`effectiveTo` date,
	`status` enum('Draft','Active','Ended','Rejected') NOT NULL DEFAULT 'Draft',
	`approvedBy` int,
	`contractReference` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `worker_engagements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `accountStatus` enum('Active','Suspended','Deactivated') DEFAULT 'Active' NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_uploadedBy_users_id_fk` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_reportId_daily_reports_id_fk` FOREIGN KEY (`reportId`) REFERENCES `daily_reports`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_workerEngagementId_worker_engagements_id_fk` FOREIGN KEY (`workerEngagementId`) REFERENCES `worker_engagements`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_markedBy_users_id_fk` FOREIGN KEY (`markedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_report_items` ADD CONSTRAINT `daily_report_items_dailyReportId_daily_reports_id_fk` FOREIGN KEY (`dailyReportId`) REFERENCES `daily_reports`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_items` ADD CONSTRAINT `material_items_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_items` ADD CONSTRAINT `material_items_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_request_items` ADD CONSTRAINT `material_request_items_requestId_material_requests_id_fk` FOREIGN KEY (`requestId`) REFERENCES `material_requests`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_request_items` ADD CONSTRAINT `material_request_items_materialItemId_material_items_id_fk` FOREIGN KEY (`materialItemId`) REFERENCES `material_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_requests` ADD CONSTRAINT `material_requests_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_requests` ADD CONSTRAINT `material_requests_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_requests` ADD CONSTRAINT `material_requests_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_requests` ADD CONSTRAINT `material_requests_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `organization_memberships_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `organization_memberships_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organization_memberships` ADD CONSTRAINT `organization_memberships_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `people` ADD CONSTRAINT `people_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `people` ADD CONSTRAINT `people_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_grants` ADD CONSTRAINT `permission_grants_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_grants` ADD CONSTRAINT `permission_grants_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_grants` ADD CONSTRAINT `permission_grants_grantedBy_users_id_fk` FOREIGN KEY (`grantedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `permission_grants` ADD CONSTRAINT `permission_grants_revokedBy_users_id_fk` FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_projectManagerUserId_users_id_fk` FOREIGN KEY (`projectManagerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `site_assignments` ADD CONSTRAINT `site_assignments_assignedBy_users_id_fk` FOREIGN KEY (`assignedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sites` ADD CONSTRAINT `sites_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sites` ADD CONSTRAINT `sites_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sites` ADD CONSTRAINT `sites_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagements_personId_people_id_fk` FOREIGN KEY (`personId`) REFERENCES `people`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagements_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `worker_engagements` ADD CONSTRAINT `worker_engagements_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attachment_entity_idx` ON `attachments` (`organizationId`,`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `attendance_site_date_idx` ON `attendance_records` (`siteId`,`workDate`);--> statement-breakpoint
CREATE INDEX `audit_org_time_idx` ON `audit_events` (`organizationId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_site_time_idx` ON `audit_events` (`siteId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_events` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `daily_report_item_parent_idx` ON `daily_report_items` (`dailyReportId`);--> statement-breakpoint
CREATE INDEX `daily_report_site_date_idx` ON `daily_reports` (`siteId`,`reportDate`);--> statement-breakpoint
CREATE INDEX `daily_report_status_idx` ON `daily_reports` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `material_request_item_parent_idx` ON `material_request_items` (`requestId`);--> statement-breakpoint
CREATE INDEX `material_request_site_date_idx` ON `material_requests` (`siteId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `material_request_status_idx` ON `material_requests` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `org_member_user_status_idx` ON `organization_memberships` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `people_org_status_idx` ON `people` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `permission_grant_lookup_idx` ON `permission_grants` (`userId`,`permissionKey`,`status`);--> statement-breakpoint
CREATE INDEX `project_org_status_idx` ON `projects` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `site_assignment_user_status_idx` ON `site_assignments` (`userId`,`status`,`siteId`);--> statement-breakpoint
CREATE INDEX `site_project_status_idx` ON `sites` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `engagement_site_status_idx` ON `worker_engagements` (`siteId`,`status`);