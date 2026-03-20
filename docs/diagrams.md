# Mermaid Diagrams

## 1. Architecture Diagram

```mermaid
flowchart LR
    User[User]
    Slack[Slack]
    Gateway[gateway]
    Orchestrator[orchestrator]
    Scheduler[scheduler]
    SQLite[(SQLite)]
    Codex[Codex app-server]

    User --> Slack
    Slack --> Gateway
    Gateway --> Orchestrator
    Scheduler --> Orchestrator
    Orchestrator --> SQLite
    Orchestrator --> Codex
    Codex --> Orchestrator
    Gateway --> Slack
```

---

## 2. Domain Model Diagram

```mermaid
classDiagram
    class Session {
      +session_id: string
      +slack_team_id: string
      +slack_channel_id: string
      +slack_root_thread_ts: string
      +codex_thread_id: string
      +state: SessionState
      +created_at: datetime
      +updated_at: datetime
    }

    class Schedule {
      +schedule_id: string
      +name: string
      +slack_user_id: string
      +slack_channel_id: string?
      +prompt_template: text
      +timezone: string
      +status: ScheduleStatus
      +next_fire_at: datetime
      +last_fired_at: datetime?
      +recurrence_type: RecurrenceType
      +cron_expr: string?
      +created_at: datetime
      +updated_at: datetime
    }

    class SessionState {
      <<enumeration>>
      idle
      running
      waiting_approval
      failed
      cancelled
    }

    class ScheduleStatus {
      <<enumeration>>
      scheduled
      firing
      fired
      failed
      cancelled
    }

    class RecurrenceType {
      <<enumeration>>
      none
      cron
    }

    class SlackThreadRef {
      +slack_team_id: string
      +slack_channel_id: string
      +slack_root_thread_ts: string
    }

    class CodexThreadRef {
      +codex_thread_id: string
    }

    Session --> SessionState
    Schedule --> ScheduleStatus
    Schedule --> RecurrenceType
    Session *-- SlackThreadRef
    Session *-- CodexThreadRef
```

---

## 3. Sequence Diagram: New Session from Slack DM

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant G as gateway
    participant O as orchestrator
    participant DB as SQLite
    participant C as Codex app-server

    U->>S: DMトップレベル投稿
    S->>G: message event
    G->>O: start_session_from_slack(...)
    O->>DB: Session作成・保存
    O->>S: 新規トップレベル投稿用情報要求
    O->>C: Codex thread 作成
    C-->>O: codex_thread_id
    O->>DB: Slack thread ↔ Codex thread 紐付け保存
    O->>C: ユーザーメッセージ送信
    C-->>O: progress / completion / approval
    O->>G: notify_progress / notify_completed / notify_approval
    G->>S: Slackメッセージ投稿・更新
    S-->>U: 表示
```

---

## 4. Sequence Diagram: Continue Existing Session from Slack Thread Reply

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant G as gateway
    participant O as orchestrator
    participant DB as SQLite
    participant C as Codex app-server

    U->>S: 既存スレッドへ返信
    S->>G: thread reply event
    G->>O: continue_session_from_slack(...)
    O->>DB: Session検索(channel_id + root_thread_ts)
    DB-->>O: Session / codex_thread_id
    O->>C: 既存 Codex thread にメッセージ送信
    C-->>O: progress / completion / approval
    O->>G: notify_progress / notify_completed / notify_approval
    G->>S: Slackスレッド投稿・更新
    S-->>U: 表示
```

---

## 5. Sequence Diagram: Running Session with Additional Message (Steer)

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant G as gateway
    participant O as orchestrator
    participant DB as SQLite
    participant C as Codex app-server

    Note over O,C: Session state = running

    U->>S: 追加メッセージ投稿
    S->>G: message event
    G->>O: continue_session_from_slack(...)
    O->>DB: Session取得
    DB-->>O: state=running
    O->>C: steer として追加メッセージ送信
    C-->>O: updated progress / completion / approval
    O->>G: notify_progress / notify_completed / notify_approval
    G->>S: Slackスレッド更新
    S-->>U: 表示
```

---

## 6. Sequence Diagram: Waiting Approval with Additional Message (Reject + New Message)

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant G as gateway
    participant O as orchestrator
    participant DB as SQLite
    participant C as Codex app-server

    Note over O,C: Session state = waiting_approval

    U->>S: 別案を通常発話で投稿
    S->>G: message event
    G->>O: continue_session_from_slack(...)
    O->>DB: Session取得
    DB-->>O: state=waiting_approval
    O->>C: current approval を Reject
    O->>C: 新しいユーザーメッセージ送信
    C-->>O: progress / completion / approval
    O->>G: notify_progress / notify_completed / notify_approval
    G->>S: Slackスレッド更新
    S-->>U: 表示
```

---

## 7. Sequence Diagram: Approval Button Flow

```mermaid
sequenceDiagram
    participant U as User
    participant S as Slack
    participant G as gateway
    participant O as orchestrator
    participant C as Codex app-server

    C-->>O: approval request
    O->>G: notify_approval(...)
    G->>S: Approve / Reject ボタン付きメッセージ
    S-->>U: 表示

    U->>S: ボタン押下
    S->>G: interactive action
    G->>O: resolve_approval(...)
    O->>C: approval decision
    C-->>O: progress / completion / next approval
    O->>G: notify_progress / notify_completed / notify_approval
    G->>S: スレッド更新
```

---

## 8. Sequence Diagram: Scheduled Session Start

```mermaid
sequenceDiagram
    participant SCH as scheduler
    participant O as orchestrator
    participant DB as SQLite
    participant G as gateway
    participant S as Slack
    participant C as Codex app-server
    participant U as User

    SCH->>DB: 発火対象 schedule 検索(next_fire_at <= now)
    SCH->>DB: schedule を firing に更新して claim
    SCH->>O: start_session_from_schedule(...)
    O->>S: 新規トップレベル投稿の準備
    O->>DB: Session作成
    O->>C: 新規 Codex thread 作成
    C-->>O: codex_thread_id
    O->>DB: Session と Codex thread を保存
    O->>C: schedule prompt を送信
    C-->>O: progress / completion / approval
    O->>G: notify_progress / notify_completed / notify_approval
    G->>S: Slack新規投稿・更新
    S-->>U: 表示
    SCH->>DB: recurring なら next_fire_at 更新 / one-shot なら fired
```
