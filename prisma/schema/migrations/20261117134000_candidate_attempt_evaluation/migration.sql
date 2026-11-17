ALTER TABLE `candidate_attempts`
    ADD COLUMN `evaluation_feedback` TEXT NULL,
    ADD COLUMN `evaluated_at` DATETIME(3) NULL,
    ADD COLUMN `evaluated_by_id` INTEGER NULL;

ALTER TABLE `candidate_questions`
    ADD COLUMN `awarded_marks` DOUBLE NULL,
    ADD COLUMN `evaluation_feedback` TEXT NULL;

ALTER TABLE `candidate_recordings`
    ADD COLUMN `awarded_marks` DOUBLE NULL,
    ADD COLUMN `evaluation_feedback` TEXT NULL;
