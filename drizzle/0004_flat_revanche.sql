ALTER TABLE `audit_events` ADD `clientMutationId` varchar(64);--> statement-breakpoint
ALTER TABLE `task_schedule_revisions` ADD `siteId` varchar(36);--> statement-breakpoint
UPDATE `task_schedule_revisions` AS revisions INNER JOIN `work_tasks` AS tasks ON tasks.`id` = revisions.`taskId` SET revisions.`siteId` = tasks.`siteId`;--> statement-breakpoint
ALTER TABLE `task_schedule_revisions` MODIFY `siteId` varchar(36) NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_actor_client_mutation_uq` UNIQUE(`actorUserId`,`clientMutationId`);--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `project_org_id_uq` UNIQUE(`organizationId`,`id`);--> statement-breakpoint
ALTER TABLE `sites` ADD CONSTRAINT `site_org_id_uq` UNIQUE(`organizationId`,`id`);--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_change_site_id_uq` UNIQUE(`siteId`,`id`);--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_task_site_id_uq` UNIQUE(`siteId`,`id`);--> statement-breakpoint
ALTER TABLE `sites` ADD CONSTRAINT `site_project_same_org_fk` FOREIGN KEY (`organizationId`,`projectId`) REFERENCES `projects`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependency_predecessor_same_site_fk` FOREIGN KEY (`siteId`,`predecessorTaskId`) REFERENCES `work_tasks`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_dependencies` ADD CONSTRAINT `task_dependency_successor_same_site_fk` FOREIGN KEY (`siteId`,`successorTaskId`) REFERENCES `work_tasks`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_change_same_org_site_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_changes` ADD CONSTRAINT `task_schedule_change_selected_same_site_fk` FOREIGN KEY (`siteId`,`selectedTaskId`) REFERENCES `work_tasks`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_revisions` ADD CONSTRAINT `task_schedule_revision_change_same_site_fk` FOREIGN KEY (`siteId`,`changeId`) REFERENCES `task_schedule_changes`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_schedule_revisions` ADD CONSTRAINT `task_schedule_revision_task_same_site_fk` FOREIGN KEY (`siteId`,`taskId`) REFERENCES `work_tasks`(`siteId`,`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `work_tasks` ADD CONSTRAINT `work_task_same_org_site_fk` FOREIGN KEY (`organizationId`,`siteId`) REFERENCES `sites`(`organizationId`,`id`) ON DELETE restrict ON UPDATE no action;
