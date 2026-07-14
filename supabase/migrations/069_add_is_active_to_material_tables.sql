-- Migration 069: Add is_active flag to material_types and material_categories
ALTER TABLE public.material_types      ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE public.material_categories ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
