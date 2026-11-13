CREATE TABLE `sample_records` (
	`id` varchar(36) NOT NULL,
	`tableName` varchar(64) NOT NULL,
	`rowId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sample_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `sample_records_row_uq` UNIQUE(`tableName`,`rowId`)
);
