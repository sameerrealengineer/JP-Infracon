CREATE TABLE `whatsapp_bot_messages` (
	`id` varchar(36) NOT NULL,
	`waMessageId` varchar(191),
	`phone` varchar(20) NOT NULL,
	`userId` int,
	`direction` enum('in','out') NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_bot_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_bot_messages_waMessageId_unique` UNIQUE(`waMessageId`)
);
--> statement-breakpoint
ALTER TABLE `whatsapp_bot_messages` ADD CONSTRAINT `whatsapp_bot_messages_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `whatsapp_bot_phone_idx` ON `whatsapp_bot_messages` (`phone`,`createdAt`);