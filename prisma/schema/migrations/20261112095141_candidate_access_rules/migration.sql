-- AlterTable
ALTER TABLE `assessments` ADD COLUMN `allow_section_switching` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `allowed_device_types` JSON NULL,
    ADD COLUMN `cities` JSON NULL,
    ADD COLUMN `regions` JSON NULL;
