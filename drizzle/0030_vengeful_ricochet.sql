ALTER TABLE `work_tasks` ADD `assigneeUserId` int;--> statement-breakpoint
ALTER TABLE `work_tasks` ADD `crewId` varchar(36);--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_tasks_assigneeUserId_users_id_fk` FOREIGN KEY (`assigneeUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_tasks_crewId_crews_id_fk` FOREIGN KEY (`crewId`) REFERENCES `crews`(`id`) ON DELETE restrict ON UPDATE no action;