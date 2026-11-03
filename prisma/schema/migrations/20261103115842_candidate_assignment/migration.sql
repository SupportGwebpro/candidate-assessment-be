/*
  Warnings:

  - A unique constraint covering the columns `[access_token]` on the table `candidates` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `candidates` ADD COLUMN `access_token` VARCHAR(191) NULL,
    ADD COLUMN `assessment_version_id` INTEGER NULL,
    ADD COLUMN `assessment_version_number` INTEGER NULL,
    ADD COLUMN `link_generated_at` DATETIME(3) NULL,
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `question_source` ENUM('SHARED', 'FRESH') NOT NULL DEFAULT 'SHARED',
    ADD COLUMN `questions_approved` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `questions_approved_at` DATETIME(3) NULL,
    ADD COLUMN `questions_approved_by_id` INTEGER NULL,
    ADD COLUMN `timer_approval_note` TEXT NULL,
    ADD COLUMN `timer_approved` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `timer_approved_at` DATETIME(3) NULL,
    ADD COLUMN `timer_approved_by_id` INTEGER NULL,
    ADD COLUMN `timer_approved_seconds` INTEGER NULL;

-- CreateTable
CREATE TABLE `candidate_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidate_id` INTEGER NOT NULL,
    `section_name` VARCHAR(191) NOT NULL,
    `type` ENUM('MCQ', 'WRITTEN') NOT NULL,
    `prompt` TEXT NOT NULL,
    `options` JSON NULL,
    `correct_option` INTEGER NULL,
    `model_answer` TEXT NULL,
    `evaluation_rubric` TEXT NULL,
    `marks` INTEGER NULL,
    `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NULL,
    `estimated_time_seconds` INTEGER NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL DEFAULT 0,
    `source_question_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `candidate_questions_candidate_id_idx`(`candidate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `candidates_access_token_key` ON `candidates`(`access_token`);

-- CreateIndex
CREATE INDEX `candidates_assessment_version_id_idx` ON `candidates`(`assessment_version_id`);

-- AddForeignKey
ALTER TABLE `candidate_questions` ADD CONSTRAINT `candidate_questions_candidate_id_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
