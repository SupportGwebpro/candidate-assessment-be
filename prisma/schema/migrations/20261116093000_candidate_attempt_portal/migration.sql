-- Add candidate portal attempt, answer, verification and incident persistence.
ALTER TABLE `candidates`
    MODIFY `status` ENUM('INVITED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'INVITED',
    ADD COLUMN `reading_task_snapshot` JSON NULL,
    ADD COLUMN `speaking_task_snapshot` JSON NULL;

CREATE TABLE `candidate_attempts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidate_id` INTEGER NOT NULL,
    `state` ENUM('IN_PROGRESS', 'DRAFT', 'SUBMITTED', 'CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
    `phase` ENUM('QUESTIONS', 'READING', 'SPEAKING') NOT NULL DEFAULT 'QUESTIONS',
    `started_at` DATETIME(3) NOT NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `task_deadline_at` DATETIME(3) NULL,
    `reading_status` ENUM('PENDING', 'READY', 'RECORDED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `speaking_status` ENUM('PENDING', 'READY', 'RECORDED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `active_question_id` INTEGER NULL,
    `drafted_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NULL,
    `submission_reason` VARCHAR(40) NULL,
    `cancellation_reason` VARCHAR(80) NULL,
    `privacy_consent_at` DATETIME(3) NOT NULL,
    `recording_consent_at` DATETIME(3) NOT NULL,
    `device_hash` VARCHAR(64) NOT NULL,
    `security_check` JSON NULL,
    `face_state` VARCHAR(16) NOT NULL DEFAULT 'present',
    `face_absent_since` DATETIME(3) NULL,
    `face_absence_counted` BOOLEAN NOT NULL DEFAULT false,
    `score` DOUBLE NULL,
    `evaluation_status` VARCHAR(24) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `candidate_attempts_state_deadline_at_idx`(`state`, `deadline_at`),
    UNIQUE INDEX `candidate_attempts_candidate_id_key`(`candidate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_recordings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `kind` ENUM('READING', 'SPEAKING') NOT NULL,
    `storage_path` VARCHAR(1024) NOT NULL,
    `content_type` VARCHAR(80) NOT NULL,
    `byte_size` INTEGER NOT NULL,
    `duration_seconds` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `candidate_recordings_attempt_id_kind_key`(`attempt_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_answers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `candidate_question_id` INTEGER NOT NULL,
    `answer` TEXT NOT NULL,
    `saved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `candidate_answers_candidate_question_id_idx`(`candidate_question_id`),
    UNIQUE INDEX `candidate_answers_attempt_id_candidate_question_id_key`(`attempt_id`, `candidate_question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_question_progress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `candidate_question_id` INTEGER NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `locked_at` DATETIME(3) NULL,
    `face_warning_count` INTEGER NOT NULL DEFAULT 0,
    INDEX `candidate_question_progress_attempt_id_started_at_idx`(`attempt_id`, `started_at`),
    UNIQUE INDEX `candidate_question_progress_attempt_id_candidate_question_id_key`(`attempt_id`, `candidate_question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_incidents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `attempt_id` INTEGER NOT NULL,
    `event_id` VARCHAR(128) NULL,
    `type` VARCHAR(40) NOT NULL,
    `detail` TEXT NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `candidate_incidents_attempt_id_occurred_at_idx`(`attempt_id`, `occurred_at`),
    UNIQUE INDEX `candidate_incidents_attempt_id_event_id_key`(`attempt_id`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `candidate_contact_verifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `candidate_id` INTEGER NOT NULL,
    `method` ENUM('EMAIL', 'PHONE') NOT NULL,
    `contact` VARCHAR(254) NOT NULL,
    `code_hash` VARCHAR(64) NOT NULL,
    `device_hash` VARCHAR(64) NOT NULL,
    `sent_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `candidate_contact_verifications_candidate_id_key`(`candidate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `candidate_attempts`
    ADD CONSTRAINT `candidate_attempts_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `candidate_answers`
    ADD CONSTRAINT `candidate_answers_attempt_id_fkey`
    FOREIGN KEY (`attempt_id`) REFERENCES `candidate_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `candidate_answers_candidate_question_id_fkey`
    FOREIGN KEY (`candidate_question_id`) REFERENCES `candidate_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `candidate_question_progress`
    ADD CONSTRAINT `candidate_question_progress_attempt_id_fkey`
    FOREIGN KEY (`attempt_id`) REFERENCES `candidate_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT `candidate_question_progress_candidate_question_id_fkey`
    FOREIGN KEY (`candidate_question_id`) REFERENCES `candidate_questions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `candidate_incidents`
    ADD CONSTRAINT `candidate_incidents_attempt_id_fkey`
    FOREIGN KEY (`attempt_id`) REFERENCES `candidate_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `candidate_recordings`
    ADD CONSTRAINT `candidate_recordings_attempt_id_fkey`
    FOREIGN KEY (`attempt_id`) REFERENCES `candidate_attempts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `candidate_contact_verifications`
    ADD CONSTRAINT `candidate_contact_verifications_candidate_id_fkey`
    FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
