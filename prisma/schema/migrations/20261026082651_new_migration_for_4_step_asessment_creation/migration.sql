-- AlterTable
ALTER TABLE `assessment_versions` MODIFY `level` ENUM('JUNIOR', 'MID', 'SENIOR') NULL,
    MODIFY `duration_minutes` INTEGER NULL;

-- AlterTable
ALTER TABLE `assessments` ADD COLUMN `blueprint_generated_at` DATETIME(3) NULL,
    ADD COLUMN `candidate_instructions` TEXT NULL,
    ADD COLUMN `closes_at` DATETIME(3) NULL,
    ADD COLUMN `eligibility_threshold` INTEGER NULL,
    ADD COLUMN `job_description` TEXT NULL,
    ADD COLUMN `job_description_file_name` VARCHAR(191) NULL,
    ADD COLUMN `opens_at` DATETIME(3) NULL,
    ADD COLUMN `save_and_resume` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `timezone` VARCHAR(191) NULL,
    MODIFY `level` ENUM('JUNIOR', 'MID', 'SENIOR') NULL,
    MODIFY `duration_minutes` INTEGER NULL;

-- CreateTable
CREATE TABLE `assessment_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessment_id` INTEGER NOT NULL,
    `section_id` INTEGER NOT NULL,
    `type` ENUM('MCQ', 'WRITTEN') NOT NULL,
    `prompt` TEXT NOT NULL,
    `options` JSON NULL,
    `correct_option` INTEGER NULL,
    `model_answer` TEXT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assessment_questions_assessment_id_idx`(`assessment_id`),
    INDEX `assessment_questions_section_id_idx`(`section_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessment_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `question_type` ENUM('MCQ_ONLY', 'WRITTEN_ONLY', 'BOTH') NOT NULL,
    `mcq_count` INTEGER NOT NULL DEFAULT 0,
    `written_count` INTEGER NOT NULL DEFAULT 0,
    `ai_guidance` TEXT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assessment_sections_assessment_id_idx`(`assessment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_skills` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessment_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assessment_skills_assessment_id_idx`(`assessment_id`),
    UNIQUE INDEX `assessment_skills_assessment_id_name_key`(`assessment_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assessment_questions` ADD CONSTRAINT `assessment_questions_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_questions` ADD CONSTRAINT `assessment_questions_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `assessment_sections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_sections` ADD CONSTRAINT `assessment_sections_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_skills` ADD CONSTRAINT `assessment_skills_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
