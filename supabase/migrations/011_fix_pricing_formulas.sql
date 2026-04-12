-- Migration 011: Fix pricing_formulas table and seed all 15 formulas
-- The description column was missing, causing the INSERT to fail after DELETE

ALTER TABLE pricing_formulas
ADD COLUMN IF NOT EXISTS description text;

-- Clear any partial data
DELETE FROM pricing_formulas;

-- Insert all 15 QMI pricing formulas
INSERT INTO pricing_formulas (name, expression, unit, description) VALUES
('Area',                             'Width * Height',                                        'Sqft', 'Banners, vinyl, wall graphics, decals — most used'),
('Total_Area',                       'Total_Area',                                            'Sqft', 'Vehicle wraps — user types total sqft directly'),
('Width',                            'Width',                                                 'Feet', 'Roll materials, linear products, channel letter coil'),
('Height',                           'Height',                                                'Feet', 'Height-only linear products'),
('Perimeter',                        '2 * (Width + Height)',                                  'Feet', 'Channel letter outlines, frames, border tape'),
('Perimeter_in_yards',               '2 * (Width_in_yards + Height_in_yards)',                'Yard', 'Perimeter measured in yards'),
('Volume',                           'Width * Height * Depth',                               'CuFt', 'Dimensional signs, 3D fabrication'),
('Board_Feet',                       '(Width_in_feet * Height * Length_in_feet) / 12',       'CuFt', 'Wood and lumber products'),
('Cylindrical_Surface_Area',         '2*3.14159*(D/2)^2 + 2*3.14159*(D/2)*Height',          'Sqft', 'Pole wraps, cylindrical signs'),
('Cylindrical_Surface_Area_in_sqyd', '(2*3.14159*(D/2)^2 + 2*3.14159*(D/2)*Height) / 9',   'SqYd', 'Large cylindrical wraps in square yards'),
('Area_in_sqyd',                     'Width_in_yards * Height_in_yards',                    'SqYd', 'Area in square yards'),
('Width_in_yards',                   'Width_in_yards',                                       'Yard', 'Width measured in yards'),
('Height_in_yards',                  'Height_in_yards',                                      'Yard', 'Height measured in yards'),
('Length_in_yards',                  'Length_in_yards',                                      'Yard', 'Length measured in yards'),
('Cyl.Vol',                          '3.14 * Radius * Radius * Height',                     'CuFt', 'Cylindrical volume for 3D objects')
ON CONFLICT (name) DO NOTHING;
