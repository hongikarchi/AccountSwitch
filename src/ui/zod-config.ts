import { z } from 'zod';

// The page's security policy forbids eval; zod would otherwise probe for it and log a violation.
// Imported first, before any schema is built.
z.config({ jitless: true });
