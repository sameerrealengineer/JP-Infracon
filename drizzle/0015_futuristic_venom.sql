CREATE TABLE `document_chunks` (
	`id` varchar(36) NOT NULL,
	`documentId` varchar(36) NOT NULL,
	`versionNumber` int NOT NULL,
	`chunkIndex` int NOT NULL,
	`content` text NOT NULL,
	`embedding` text,
	`embeddingModel` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `document_chunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_document_versions` (
	`id` varchar(36) NOT NULL,
	`documentId` varchar(36) NOT NULL,
	`versionNumber` int NOT NULL,
	`attachmentId` varchar(36) NOT NULL,
	`note` varchar(500),
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_document_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_document_version_uq` UNIQUE(`documentId`,`versionNumber`)
);
--> statement-breakpoint
CREATE TABLE `project_documents` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`siteId` varchar(36),
	`category` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`tags` varchar(500),
	`currentVersion` int NOT NULL DEFAULT 1,
	`status` enum('Active','Archived') NOT NULL DEFAULT 'Active',
	`aiDocumentType` varchar(80),
	`aiSummary` text,
	`aiFields` text,
	`indexStatus` enum('Pending','Indexed','Keyword only','Failed') NOT NULL DEFAULT 'Pending',
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `project_documents_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `document_chunks` ADD CONSTRAINT `document_chunks_documentId_project_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `project_documents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_document_versions` ADD CONSTRAINT `project_document_versions_documentId_project_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `project_documents`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_document_versions` ADD CONSTRAINT `project_document_versions_attachmentId_attachments_id_fk` FOREIGN KEY (`attachmentId`) REFERENCES `attachments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_document_versions` ADD CONSTRAINT `project_document_versions_uploadedBy_users_id_fk` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `document_chunk_document_idx` ON `document_chunks` (`documentId`,`chunkIndex`);--> statement-breakpoint
CREATE INDEX `project_document_project_idx` ON `project_documents` (`organizationId`,`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `project_document_site_idx` ON `project_documents` (`siteId`);