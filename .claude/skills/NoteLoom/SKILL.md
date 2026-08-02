```markdown
# NoteLoom Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides a comprehensive guide to the development patterns used in the NoteLoom repository, a TypeScript project built with Next.js. It documents the project's coding conventions, including file naming, import/export styles, and testing patterns. This guide is intended to help contributors maintain consistency and efficiency when working on NoteLoom.

## Coding Conventions

### File Naming
- **Pattern:** kebab-case
- **Example:**  
  - `note-list.tsx`
  - `user-profile.test.ts`

### Import Style
- **Pattern:** Alias imports (using configured aliases, not relative paths)
- **Example:**
  ```typescript
  import { NoteList } from '@components/note-list';
  ```

### Export Style
- **Pattern:** Named exports
- **Example:**
  ```typescript
  // In note-list.tsx
  export const NoteList = () => { /* ... */ };
  ```

### Commit Messages
- **Pattern:** Freeform, no enforced type or prefix
- **Average length:** ~72 characters
- **Example:**  
  `Add support for markdown rendering in note details`

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- **Framework:** Unknown (not detected)
- **Test File Pattern:** Files are named with `.test.` in the filename.
- **Example:**
  - `note-list.test.ts`
  - `api-handler.test.ts`

- **Typical Test Structure:**
  ```typescript
  // note-list.test.ts
  import { NoteList } from '@components/note-list';

  describe('NoteList', () => {
    it('renders notes correctly', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command | Purpose |
|---------|---------|
| /new-component | Scaffold a new component following kebab-case and alias import conventions |
| /run-tests | Run all test files matching *.test.* |
| /format-code | Format code according to project conventions |
```