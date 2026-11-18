CREATE TABLE `material_coefficients` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`contractItemId` varchar(36) NOT NULL,
	`material` enum('Cement','Steel') NOT NULL,
	`perUnitThousandths` decimal(18,0) NOT NULL,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `material_coefficients_id` PRIMARY KEY(`id`),
	CONSTRAINT `coefficient_item_material_uq` UNIQUE(`contractItemId`,`material`)
);
--> statement-breakpoint
CREATE TABLE `quality_tests` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`siteId` varchar(36) NOT NULL,
	`setId` varchar(36),
	`testType` varchar(60) NOT NULL,
	`grade` varchar(20),
	`location` varchar(200) NOT NULL,
	`sampledOn` date NOT NULL,
	`dueDate` date,
	`minValue` varchar(20),
	`maxValue` varchar(20),
	`results` varchar(200),
	`pass` enum('Yes','No'),
	`verdict` varchar(300),
	`labName` varchar(160),
	`reportReference` varchar(120),
	`status` enum('Pending','Done') NOT NULL DEFAULT 'Pending',
	`clientMutationId` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`resultBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quality_tests_id` PRIMARY KEY(`id`),
	CONSTRAINT `quality_tests_clientMutationId_unique` UNIQUE(`clientMutationId`)
);
--> statement-breakpoint
ALTER TABLE `material_coefficients` ADD CONSTRAINT `material_coefficients_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_coefficients` ADD CONSTRAINT `material_coefficients_projectId_projects_id_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_coefficients` ADD CONSTRAINT `material_coefficients_contractItemId_contract_items_id_fk` FOREIGN KEY (`contractItemId`) REFERENCES `contract_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `material_coefficients` ADD CONSTRAINT `material_coefficients_updatedBy_users_id_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_tests` ADD CONSTRAINT `quality_tests_organizationId_organizations_id_fk` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_tests` ADD CONSTRAINT `quality_tests_siteId_sites_id_fk` FOREIGN KEY (`siteId`) REFERENCES `sites`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_tests` ADD CONSTRAINT `quality_tests_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quality_tests` ADD CONSTRAINT `quality_tests_resultBy_users_id_fk` FOREIGN KEY (`resultBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `quality_site_due_idx` ON `quality_tests` (`siteId`,`dueDate`);