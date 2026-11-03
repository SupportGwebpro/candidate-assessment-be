-- AlterTable
ALTER TABLE `assessment_questions` ADD COLUMN `approved` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by_id` INTEGER NULL,
    ADD COLUMN `difficulty` ENUM('EASY', 'MEDIUM', 'HARD') NULL,
    ADD COLUMN `estimated_time_seconds` INTEGER NULL,
    ADD COLUMN `evaluation_rubric` TEXT NULL,
    ADD COLUMN `marks` INTEGER NULL,
    ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `assessment_sections` ADD COLUMN `cutoff` INTEGER NULL,
    ADD COLUMN `instructions` TEXT NULL;

-- AlterTable
ALTER TABLE `assessments` ADD COLUMN `timer_approved` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `timer_approved_at` DATETIME(3) NULL,
    ADD COLUMN `timer_approved_by_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `assessment_competencies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessment_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assessment_competencies_assessment_id_idx`(`assessment_id`),
    UNIQUE INDEX `assessment_competencies_assessment_id_name_key`(`assessment_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_key_result_areas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessment_id` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assessment_key_result_areas_assessment_id_idx`(`assessment_id`),
    UNIQUE INDEX `assessment_key_result_areas_assessment_id_title_key`(`assessment_id`, `title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `assessment_questions_approved_idx` ON `assessment_questions`(`approved`);

-- AddForeignKey
ALTER TABLE `assessment_competencies` ADD CONSTRAINT `assessment_competencies_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_key_result_areas` ADD CONSTRAINT `assessment_key_result_areas_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
