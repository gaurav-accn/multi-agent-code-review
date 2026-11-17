# 🔍 Code Review Report: udacity/cd14715-simple-todo-app #2

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 9/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 3 |
| **High Priority Tests** | 10 |
| **Refactoring Opportunities** | 5 |

## 🎯 Recommendations

1. 🚨 **[CRITICAL] Security**: Fix SQL injection vulnerabilities in all three new search functions (searchTodos, searchTodosByStatus, getTodosByUser) by replacing string concatenation with parameterized queries using the $1, $2 placeholder pattern already established in the codebase.
   - Files: `src/todo.ts`

2. 🚨 **[CRITICAL] Testing**: Add comprehensive test coverage for the three new search functions, including tests that demonstrate the SQL injection vulnerabilities exist and verify they are properly fixed after refactoring to use parameterized queries.
   - Files: `src/todo.ts`

3. ⚠️ **[HIGH] Type Safety**: Fix type mismatch in searchTodosByStatus by changing the 'completed' parameter from string to boolean to match the database schema, Todo interface, and existing updateTodoStatus function signature.
   - Files: `src/todo.ts`

4. ⚠️ **[HIGH] Testing**: Add edge case tests for empty/invalid input validation, including empty keyword in searchTodos, invalid boolean values in searchTodosByStatus, empty userId in getTodosByUser, and malformed database response handling.
   - Files: `src/todo.ts`

5. 📝 **[MEDIUM] Code Quality**: Add input validation for all search function parameters: limit keyword length to prevent performance issues, validate userId format (e.g., UUID pattern), and validate boolean conversion for completed status.
   - Files: `src/todo.ts`

6. 📝 **[MEDIUM] Refactoring**: Consider adding runtime type validation for database query results using a schema validator (e.g., zod) instead of unchecked 'as Todo[]' casts to prevent type safety violations if database schema changes.
   - Files: `src/todo.ts`

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 0/100 | **Estimated Coverage:** ~0% | **Has Tests:** yes (`src/todo.test.ts`)

#### 🛡️ Code Quality (9 issues)
Three critical SQL injection vulnerabilities in newly added search functions (lines 120, 130, 140) make this code exploitable for data theft and manipulation. All three functions use string concatenation/interpolation instead of parameterized queries, contradicting the secure pattern established in the rest of the file.

| Line | Severity | Category | Issue | Suggestion |
|------|----------|----------|-------|------------|
| 120 | 🚨 `critical` | security | SQL injection vulnerability: the 'keyword' parameter is directly interpolated into the SQL query using template literals. An attacker could inject malicious SQL (e.g., keyword="' OR '1'='1" or "'; DROP TABLE todos; --") to bypass filters, extract data, or modify/delete records. | Use parameterized queries: const query = 'SELECT * FROM todos WHERE title LIKE $1 OR description LIKE $2'; const rows = await db.query(query, [`%${keyword}%`, `%${keyword}%`]); |
| 130 | 🚨 `critical` | security | SQL injection vulnerability: the 'completed' parameter is directly concatenated into the SQL query without parameterization. An attacker could inject arbitrary SQL (e.g., completed="1 OR 1=1" or "1; DELETE FROM todos") to access all records or execute destructive commands. | Use parameterized queries and validate input type: const sql = 'SELECT * FROM todos WHERE completed = $1'; const completedBool = completed === 'true'; const rows = await db.query(sql, [completedBool]); |
| 140 | 🚨 `critical` | security | SQL injection vulnerability: the 'userId' parameter is directly interpolated into a JOIN query using template literals. An attacker could inject SQL (e.g., userId="' OR '1'='1") to access todos belonging to other users or extract sensitive data from related tables. | Use parameterized queries: const query = 'SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = $1'; const rows = await db.query(query, [userId]); |
| 128 | ⚠️ `high` | bug-risk | Type mismatch: the 'completed' parameter is typed as string but should be boolean. The database column is likely boolean, and string concatenation into SQL creates both a type error and enables SQL injection. No validation or type conversion is performed. | Change parameter type to boolean or validate and convert: export async function searchTodosByStatus(completed: boolean): Promise<Todo[]> { const sql = 'SELECT * FROM todos WHERE completed = $1'; const rows = await db.query(sql, [completed]); return rows as Todo[]; } |
| 121 | 📝 `medium` | bug-risk | Unchecked type assertion: 'rows as Todo[]' assumes the database query returns properly shaped Todo objects without runtime validation. If the database schema changes or returns unexpected data, this could cause runtime errors or type safety violations. | Add runtime validation using a type guard or schema validator (e.g., zod): const todoSchema = z.object({ id: z.string(), title: z.string(), ... }); return z.array(todoSchema).parse(rows); |
| 131 | 📝 `medium` | bug-risk | Unchecked type assertion: 'rows as Todo[]' assumes the database query returns properly shaped Todo objects without runtime validation. If the database schema changes or returns unexpected data, this could cause runtime errors or type safety violations. | Add runtime validation using a type guard or schema validator (e.g., zod): const todoSchema = z.object({ id: z.string(), title: z.string(), ... }); return z.array(todoSchema).parse(rows); |
| 141 | 📝 `medium` | bug-risk | Unchecked type assertion: 'rows as Todo[]' assumes the database query returns properly shaped Todo objects without runtime validation. If the database schema changes or returns unexpected data, this could cause runtime errors or type safety violations. | Add runtime validation using a type guard or schema validator (e.g., zod): const todoSchema = z.object({ id: z.string(), title: z.string(), ... }); return z.array(todoSchema).parse(rows); |
| 119 | 💡 `low` | maintainability | Missing input validation: the 'keyword' parameter has no length or format validation. While the SQL injection must be fixed with parameterization, additional validation would prevent excessively long search terms that could impact database performance. | Add input validation: if (!keyword \|\| keyword.length > 100) { throw new Error('Invalid search keyword'); } |
| 137 | 💡 `low` | maintainability | Missing input validation: the 'userId' parameter has no format validation. While parameterization fixes the SQL injection, validating the userId format (e.g., UUID, expected pattern) would catch errors earlier and improve security defense-in-depth. | Add input validation: if (!userId \|\| !userId.match(/^[a-zA-Z0-9_-]+$/)) { throw new Error('Invalid user ID format'); } |

#### 🧪 Test Coverage Gaps (10)
The three new search functions have zero test coverage. All three contain critical SQL injection vulnerabilities that are completely untested, making this a high-risk change. The existing test file only covers validateTodoInput and sanitizeInput from the original code.

1. **`searchTodos (lines 119-123)`** (function, 🚨 critical priority)
   SQL injection vulnerability through string concatenation with user-supplied keyword. No test exists to verify the function works correctly or to demonstrate the security risk. This function directly exposes the database to arbitrary SQL injection attacks.

   ```typescript
   it('searches todos by keyword in title and description', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([{ id: '1', title: 'Buy milk', description: 'From store', completed: false, createdAt: new Date() }]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const results = await searchTodos('milk');
     expect(results).toHaveLength(1);
     expect(results[0].title).toBe('Buy milk');
     expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("LIKE '%milk%'"));
   });
   ```

2. **`searchTodos - SQL injection attack vector (line 121)`** (edge-case, 🚨 critical priority)
   The function is vulnerable to SQL injection. A malicious keyword like "'; DROP TABLE todos; --" would be directly interpolated into the query. This critical security vulnerability has no test demonstrating it can be exploited.

   ```typescript
   it('is vulnerable to SQL injection via keyword parameter', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const maliciousKeyword = "'; DROP TABLE todos; --";
     await searchTodos(maliciousKeyword);
     expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("'; DROP TABLE todos; --"));
     // This test demonstrates the vulnerability exists
   });
   ```

3. **`searchTodos - empty keyword (line 119)`** (edge-case, ⚠️ high priority)
   No validation exists for empty or whitespace-only keywords. The function would execute a query matching all todos, potentially causing performance issues. No test validates this edge case behavior.

   ```typescript
   it('returns all todos when keyword is empty string', async () => {
     const mockTodos = [{ id: '1', title: 'Task 1', description: 'Desc 1', completed: false, createdAt: new Date() }, { id: '2', title: 'Task 2', description: 'Desc 2', completed: true, createdAt: new Date() }];
     const mockDb = { query: jest.fn().mockResolvedValue(mockTodos) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const results = await searchTodos('');
     expect(results).toHaveLength(2);
   });
   ```

4. **`searchTodosByStatus (lines 129-133)`** (function, 🚨 critical priority)
   SQL injection vulnerability through string concatenation. The 'completed' parameter is typed as string but should be boolean. No test validates this function or demonstrates the security flaw.

   ```typescript
   it('searches todos by completed status', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([{ id: '1', title: 'Done task', description: 'Finished', completed: true, createdAt: new Date() }]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const results = await searchTodosByStatus('true');
     expect(results).toHaveLength(1);
     expect(results[0].completed).toBe(true);
   });
   ```

5. **`searchTodosByStatus - SQL injection attack (line 131)`** (edge-case, 🚨 critical priority)
   Direct string concatenation allows SQL injection. An input like "true OR 1=1" or "true; DELETE FROM todos" would be concatenated directly into the SQL. No test demonstrates this critical vulnerability.

   ```typescript
   it('is vulnerable to SQL injection via completed parameter', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const maliciousInput = "true OR 1=1";
     await searchTodosByStatus(maliciousInput);
     expect(mockDb.query).toHaveBeenCalledWith("SELECT * FROM todos WHERE completed = true OR 1=1");
   });
   ```

6. **`searchTodosByStatus - type mismatch (line 129)`** (edge-case, ⚠️ high priority)
   The parameter is typed as string but represents a boolean value. No validation converts or validates the input. Invalid values like 'maybe' or '123' would generate invalid SQL. No test covers these invalid inputs.

   ```typescript
   it('handles invalid boolean string values', async () => {
     const mockDb = { query: jest.fn().mockRejectedValue(new Error('Invalid boolean syntax')) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     await expect(searchTodosByStatus('invalid')).rejects.toThrow();
   });
   ```

7. **`getTodosByUser (lines 139-143)`** (function, 🚨 critical priority)
   SQL injection vulnerability via template literal with user-supplied userId. This function performs a JOIN query exposing both todos and user_todos tables to injection attacks. No tests exist.

   ```typescript
   it('retrieves todos for a specific user', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([{ id: '1', title: 'User task', description: 'Personal todo', completed: false, createdAt: new Date() }]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const results = await getTodosByUser('user123');
     expect(results).toHaveLength(1);
     expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("user_id = 'user123'"));
   });
   ```

8. **`getTodosByUser - SQL injection in JOIN (line 141)`** (edge-case, 🚨 critical priority)
   Template literal injection allows attackers to manipulate the JOIN query. Input like "' OR '1'='1" or "'; DROP TABLE user_todos; --" would be directly interpolated, potentially compromising multiple tables. No test demonstrates this vulnerability.

   ```typescript
   it('is vulnerable to SQL injection via userId in JOIN query', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const maliciousUserId = "' OR '1'='1";
     await getTodosByUser(maliciousUserId);
     expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("user_id = '' OR '1'='1'"));
   });
   ```

9. **`getTodosByUser - empty userId (line 139)`** (edge-case, ⚠️ high priority)
   No validation for empty or whitespace userId. An empty string would result in a query selecting todos where user_id = '', which may return unexpected results or errors. No test validates this edge case.

   ```typescript
   it('handles empty userId parameter', async () => {
     const mockDb = { query: jest.fn().mockResolvedValue([]) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const results = await getTodosByUser('');
     expect(results).toHaveLength(0);
     expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining("user_id = ''"));
   });
   ```

10. **`All three functions - unchecked cast 'as Todo[]' (lines 122, 132, 142)`** (edge-case, ⚠️ high priority)
   Database query results are cast to Todo[] without runtime validation. If the database returns malformed data, unexpected fields, or null values, the application would propagate invalid data. No tests verify the shape of returned data matches the Todo interface.

   ```typescript
   it('casts database results without validation', async () => {
     const malformedData = [{ id: '1', title: 'Task', wrongField: true }];
     const mockDb = { query: jest.fn().mockResolvedValue(malformedData) };
     jest.spyOn(require('./database'), 'db', 'get').mockReturnValue(mockDb);
     const results = await searchTodos('Task');
     expect(results[0]).not.toHaveProperty('description');
     expect(results[0]).not.toHaveProperty('completed');
     // Demonstrates the lack of runtime validation
   });
   ```

#### ♻️ Refactoring Opportunities (5)
The file demonstrates good structural patterns in existing code (parameterized queries, explicit interfaces, input sanitization) but the three new search functions break established patterns by using string concatenation. Primary refactoring opportunity is applying the existing parameterized query pattern consistently and fixing the string-to-boolean type mismatch in searchTodosByStatus.

1. **pattern-improvement** at `searchTodos, searchTodosByStatus, getTodosByUser (lines 119-145)` (high impact): Extract parameterized query pattern used consistently in createTodo, getTodoById, updateTodoStatus, and deleteTodo. All three new search functions violate the established pattern by using string concatenation instead of parameterized queries.

   **Before:**

   ```typescript
   export async function searchTodos(keyword: string): Promise<Todo[]> {
     const query = `SELECT * FROM todos WHERE title LIKE '%${keyword}%' OR description LIKE '%${keyword}%'`;
     const rows = await db.query(query);
     return rows as Todo[];
   }

   export async function searchTodosByStatus(completed: string): Promise<Todo[]> {
     const sql = "SELECT * FROM todos WHERE completed = " + completed;
     const rows = await db.query(sql);
     return rows as Todo[];
   }

   export async function getTodosByUser(userId: string): Promise<Todo[]> {
     const query = `SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = '${userId}'`;
     const rows = await db.query(query);
     return rows as Todo[];
   }
   ```

   **After:**

   ```typescript
   export async function searchTodos(keyword: string): Promise<Todo[]> {
     const query = 'SELECT * FROM todos WHERE title LIKE $1 OR description LIKE $1';
     const rows = await db.query(query, [`%${keyword}%`]);
     return rows as Todo[];
   }

   export async function searchTodosByStatus(completed: boolean): Promise<Todo[]> {
     const query = 'SELECT * FROM todos WHERE completed = $1';
     const rows = await db.query(query, [completed]);
     return rows as Todo[];
   }

   export async function getTodosByUser(userId: string): Promise<Todo[]> {
     const query = 'SELECT t.* FROM todos t JOIN user_todos ut ON t.id = ut.todo_id WHERE ut.user_id = $1';
     const rows = await db.query(query, [userId]);
     return rows as Todo[];
   }
   ```

   _Benefits:_ Applies the parameterized query pattern consistently across all database operations, matching the existing architectural decision in the codebase. Eliminates structural inconsistency between new and existing code.

2. **modernize** at `searchTodosByStatus (line 128)` (medium impact): Change parameter type from string to boolean to match the database schema and Todo interface. The completed field is typed as boolean in the Todo interface (line 11) and other functions like updateTodoStatus already use boolean.

   **Before:**

   ```typescript
   export async function searchTodosByStatus(completed: string): Promise<Todo[]> {
     const sql = "SELECT * FROM todos WHERE completed = " + completed;
     const rows = await db.query(sql);
     return rows as Todo[];
   }
   ```

   **After:**

   ```typescript
   export async function searchTodosByStatus(completed: boolean): Promise<Todo[]> {
     const query = 'SELECT * FROM todos WHERE completed = $1';
     const rows = await db.query(query, [completed]);
     return rows as Todo[];
   }
   ```

   _Benefits:_ Type-safe boundary prevents passing arbitrary strings like 'true' or '1' and ensures consistency with the Todo interface definition. Aligns with updateTodoStatus which already accepts boolean.

3. **simplify** at `searchTodosByStatus (line 129)` (low impact): Rename variable 'sql' to 'query' for consistency with the established naming convention used in all other database functions in the file.

   **Before:**

   ```typescript
   const sql = "SELECT * FROM todos WHERE completed = " + completed;
   ```

   **After:**

   ```typescript
   const query = 'SELECT * FROM todos WHERE completed = $1';
   ```

   _Benefits:_ Maintains consistent naming conventions across the codebase, making the code more predictable and easier to navigate.

4. **modernize** at `All query functions returning Todo[] (lines 119, 128, 138)` (medium impact): The unchecked cast 'as Todo[]' assumes database rows match the TypeScript interface without runtime validation. While this is a common pattern in the existing codebase (getAllTodos, getTodoById), consider adding explicit return type annotations to exported functions as per TypeScript best practices.

   **Before:**

   ```typescript
   export async function searchTodos(keyword: string): Promise<Todo[]> {
     const query = `SELECT * FROM todos WHERE title LIKE '%${keyword}%' OR description LIKE '%${keyword}%'`;
     const rows = await db.query(query);
     return rows as Todo[];
   }
   ```

   **After:**

   ```typescript
   export async function searchTodos(keyword: string): Promise<Todo[]> {
     const query = 'SELECT * FROM todos WHERE title LIKE $1 OR description LIKE $1';
     const rows = await db.query(query, [`%${keyword}%`]);
     return rows as Todo[];
   }
   ```

   _Benefits:_ Explicit return types on exported functions improve API documentation and catch return type mismatches at compile time. The return type is already declared in the signature, ensuring consistency.

5. **pattern-improvement** at `validateTodoInput (lines 25-35)` (medium impact): Replace early-return boolean validation pattern with a discriminated union that provides error messages. This makes validation failures more debuggable and aligns with modern TypeScript error handling.

   **Before:**

   ```typescript
   export function validateTodoInput(input: CreateTodoInput): boolean {
     if (!input.title || input.title.trim().length === 0) {
       return false;
     }
     if (input.title.length > 200) {
       return false;
     }
     if (input.description && input.description.length > 1000) {
       return false;
     }
     return true;
   }
   ```

   **After:**

   ```typescript
   type ValidationResult = 
     | { ok: true }
     | { ok: false; error: string };

   export function validateTodoInput(input: CreateTodoInput): ValidationResult {
     if (!input.title || input.title.trim().length === 0) {
       return { ok: false, error: 'Title is required' };
     }
     if (input.title.length > 200) {
       return { ok: false, error: 'Title must be 200 characters or less' };
     }
     if (input.description && input.description.length > 1000) {
       return { ok: false, error: 'Description must be 1000 characters or less' };
     }
     return { ok: true };
   }
   ```

   _Benefits:_ Provides actionable error messages for API responses instead of generic 'Invalid todo input'. Discriminated unions are type-safe and idiomatic in modern TypeScript.

---

*Generated at 2026-11-17T08:52:16.287Z • Duration: 204.4s • Agents: orchestrator@1.0.0, code-quality-analyzer@1.0.0, test-coverage-analyzer@1.0.0, refactoring-suggester@1.0.0, model@claude-sonnet-4-5-20250929*
