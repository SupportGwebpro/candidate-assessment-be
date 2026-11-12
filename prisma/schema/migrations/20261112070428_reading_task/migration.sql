-- CreateTable
CREATE TABLE `assessment_reading_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessment_id` INTEGER NOT NULL,
    `passage` TEXT NULL,
    `max_marks` INTEGER NULL,
    `reading_window_seconds` INTEGER NULL,
    `ai_suggested_window_seconds` INTEGER NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `approved_at` DATETIME(3) NULL,
    `approved_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assessment_reading_tasks_assessment_id_key`(`assessment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assessment_reading_tasks` ADD CONSTRAINT `assessment_reading_tasks_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
