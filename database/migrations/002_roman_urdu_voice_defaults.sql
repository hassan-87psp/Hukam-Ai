-- HUKM AI only: switch existing user voice settings to Roman Urdu once.
-- All unrelated settings, accounts, devices and permissions stay unchanged.
UPDATE user_settings
SET settings = json_set(settings, '$.responseLang', 'roman', '$.recognitionLang', 'en-PK', '$.voiceURI', json('null')),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
