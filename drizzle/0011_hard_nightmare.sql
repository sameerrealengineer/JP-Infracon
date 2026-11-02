ALTER TABLE `petty_cash_movements` ADD `expenseFundingSource` enum('Site Petty Cash');--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD `fundSourceAttestation` enum('Not Applicable','Confirmed') DEFAULT 'Not Applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD `taskCodeSnapshot` varchar(64);--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD `taskTitleSnapshot` varchar(180);--> statement-breakpoint
ALTER TABLE `petty_cash_movements` ADD `taskStatusSnapshot` varchar(64);