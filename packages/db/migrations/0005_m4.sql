CREATE TABLE `secrets` (
	`ref` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`updated_at` integer NOT NULL
);
