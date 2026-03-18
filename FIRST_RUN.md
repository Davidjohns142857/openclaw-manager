# OpenClaw Manager First Run

This is the user-facing first-run guide for OpenClaw Manager.

If you have just installed the skill, this is the shortest correct mental model:

- normal chat stays normal chat
- only durable work should become a manager `session`
- when a task deserves persistent tracking, use `/adopt`
- use `/tasks` and `/focus` to see what is already being tracked

## 1. What Manager Is For

OpenClaw Manager is for work that needs one or more of these:

- follow-up across multiple turns or multiple days
- external dependencies
- a clear deliverable
- checkpoints and recovery
- “come back to this later” task management

Do not adopt every chat.

Good candidates:

- “Research this topic and keep tracking it.”
- “Help me follow up on this project over the next few days.”
- “Organize this task and keep a durable record.”
- “Keep watching this issue / repo / thread and update me later.”

## 2. The First Commands To Know

### `/adopt`

Use this when a chat should become a durable manager session.

After `/adopt`, the task gets:

- a stable `session`
- resumable state
- run/checkpoint history
- appearance in `/tasks` and `/focus`

### `/tasks`

Use this to see your full tracked work list.

You should expect:

- active sessions
- waiting / blocked sessions
- last activity
- current run state

### `/focus`

Use this when you only want the most important next actions.

This is the “what should I look at now?” view.

### `/resume <session_id>`

Use this to continue a previously adopted task.

### `/checkpoint <session_id>`

Use this to save current durable recovery state before you switch context.

### `/close <session_id>`

Use this when the tracked task is done or intentionally abandoned.

## 3. The Default Daily Workflow

1. Talk to OpenClaw normally.
2. When a task becomes persistent, use `/adopt`.
3. Use `/tasks` to review all tracked sessions.
4. Use `/focus` to see the most urgent ones.
5. Use `/resume` to continue one.
6. Use `/checkpoint` when pausing.
7. Use `/close` when finished.

## 4. Cloud / Hosted Environments

In OpenClaw Cloud or other hosted environments, automatic message interception may be unavailable.

If hook installation is unavailable, Manager runs in:

- `manual /adopt` mode

That means:

- you continue chatting normally
- when a task deserves durable tracking, you explicitly run `/adopt`
- `/tasks`, `/focus`, `/resume`, `/checkpoint`, and `/close` still work normally

This is expected behavior, not a broken install.

## 5. What Users Should Expect After Setup

After setup, a new user should understand these three truths immediately:

- not every conversation becomes a session
- `/adopt` is the upgrade step into durable tracking
- `/tasks` and `/focus` are the primary ways to inspect tracked work

## 6. Quick Examples

Example 1:

- “Please research this paper and keep following related work.”
- Then run: `/adopt`

Example 2:

- “What am I currently tracking?”
- Run: `/tasks`

Example 3:

- “What needs my attention first?”
- Run: `/focus`

Example 4:

- “Continue the project-planning session from yesterday.”
- Run: `/resume <session_id>`

## 7. If A Session Page Exists

Some deployments may also publish a read-only session board URL.

That page is optional.

The primary product remains:

- chat first
- manager commands second
- board as an optional companion view

If a board link is shown, it should be treated as:

- your own read-only tracking view
- not the canonical mutation surface

Mutations still belong to Manager commands such as:

- `/adopt`
- `/resume`
- `/checkpoint`
- `/close`
