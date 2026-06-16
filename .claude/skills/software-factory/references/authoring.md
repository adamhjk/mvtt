# Authoring a factory definition

A factory definition lives in the model instance's `globalArguments`:
`stages` (the machine) and optional `globalTransitions`. There is no
workItem in the definition — one factory serves many work items, passed as
a method argument on every call. Start from `examples/minimal.yaml`,
`examples/feature-factory.yaml`, or `examples/sdlc-classic.yaml` in the
extension, then run `validate` and `describe` until clean and confirmed by
the human.

`swamp model create @adam/software-factory <name>` writes the definition
file to `models/@adam/software-factory/<id>.yaml` in the repo — edit that
file directly (it's git-tracked YAML). The stage document goes under
`globalArguments:`; `reports:` and `checks:` selections are top-level keys
beside it, not inside it.

## Stages

```yaml
stages:
  - id: plan-review # lowercase, -/_ separators
    description: optional prose
    initial: true # exactly one stage
    terminal: true # at least one stage (no transitions out)
    maxCycles: 5 # re-entry circuit breaker, default 5
    work: { ... } # how the work gets done (below)
    artifacts: [...] # declared data products (below)
    evidence: [...] # declared external facts: - name: change-request
    transitions: [...] # gated edges (below)
```

## Work modes

| mode          | executor                                | keys                                                            |
| ------------- | --------------------------------------- | --------------------------------------------------------------- |
| `interactive` | the driving agent in conversation       | `skills`, `systemPrompt`, `constraints`                         |
| `dispatch`    | one subagent per listed skill, parallel | + `command` template                                            |
| `workflow`    | a named swamp workflow                  | `workflow: {name, inputs}`, `resultEvidence`                    |
| `method`      | one model method call                   | `method: {modelIdOrName, methodName, inputs}`, `resultEvidence` |

`workflow`/`method` stages should declare `resultEvidence` (the evidence name
the driver records the outcome under) — `validate` warns otherwise. Tracker
integrations are `method` stages invoking tracker-specific models.

**Run-data bindings** use platform CEL syntax and resolve at stage execution
time against the run's own records:

```yaml
inputs:
  ref: '${{ data.latest(self.name, "evidence-change-request").payload.headSha }}'
```

Bindings may only reference data written by earlier stages. `status` returns
the work spec with bindings already resolved.

## Artifacts

```yaml
artifacts:
  - name: plan-review
    kind: findings # unlocks findings gates + resolve_findings
    reviews: plan # subject link: pins subject version on record
    schema: # JSON-Schema-flavored subset, compiled to zod
      type: object
      required: [summary]
      properties:
        summary: { type: string, minLength: 1 }
```

Schema subset: `type` (object/array/string/number/integer/boolean),
`properties`, `required`, `items`, `enum`, `pattern`, `minLength`/`maxLength`,
`minimum`/`maximum`, `minItems`/`maxItems`. Unknown keywords are rejected at
authoring time. `kind: findings` payloads must contain
`findings: [{id, severity, description, category?, resolved?, resolutionNote?}]`
with severity in critical/high/medium/low.

Artifact and evidence names are **global to the machine** — declare each
once, on the stage that records it, and reference them from any stage's
gates. At run time every record is namespaced per work item
(`artifact-<workItem>-<name>`), so parallel work items never collide; the
binding/gate vocabulary stays logical (`artifact-plan`).

**The schema you declare is also the retrieval contract.** Records store the
envelope as their content, with the schema-validated payload at
`attributes.payload.<field>` — so a driver fetches exactly the fields it
needs with `swamp data query … --select attributes.payload.<field>` instead
of pulling whole payloads. Well-named, well-structured schema fields pay off
at query time; see `driving.md` "Querying run data" for the definition →
query recipes.

## Gates

All gates on a transition must pass for `advance`.

| type                 | config                                      | passes when                                                                                                                                            |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `artifact-exists`    | `artifact`                                  | ≥1 version recorded                                                                                                                                    |
| `artifact-fresh`     | `artifact`, `recordedThisCycle?`            | pinned subject version is current; with `recordedThisCycle`, latest version was recorded during the current stage entry (forces re-review on re-entry) |
| `findings-clear`     | `artifact`, `blocking: [severities]`        | no unresolved finding at a blocking severity                                                                                                           |
| `human-approval`     | `id`, `minApprovals?`                       | enough `approve` records for the current (stage, cycle); any rejection blocks                                                                          |
| `evidence-recorded`  | `name`, `requireField?`                     | evidence recorded during the current (stage, cycle); optional dot-path field matching, e.g. `{status: succeeded}`                                      |
| `cooldown`           | `afterEvidence`\|`afterArtifact`, `seconds` | enough wall-clock time since the record                                                                                                                |
| `max-cycles`         | `stage`, `limit`, `invert?`                 | routing only (e.g. make `escalate` live after N rounds) — the safety net is the per-stage `maxCycles`                                                  |
| `cel`                | `expr`, `message?`                          | the CEL predicate is true over `artifacts.<snake_name>`, `evidence.<snake_name>`, `approvals`, `state`, `workItem`                                     |
| `workflow-succeeded` | `workflow`, `requireStepOutputs?`           | swamp's own run record for the named workflow shows the latest run succeeded during this stage entry — verified, not attested                          |

Reserved: `human-approval` ids must not start with `cycle-override:`.

## Transitions

```yaml
transitions:
  - name: approve
    to: implementing
    manual: true # optional: human "go" even when all gates pass
    gates: [...]
globalTransitions: # available from every non-terminal stage
  - name: abort
    to: aborted
    gates: [{ type: human-approval, config: { id: abort-confirmation } }]
```

Loop-backs ("send back to implementation") are ordinary transitions to
earlier stages. Re-entry increments the stage's cycle: approvals and
evidence are cycle-scoped, so stale sign-offs and stale test runs cannot
carry across rework automatically.

## Validation rules (`validate` / enforced on every method)

Exactly one initial, ≥1 terminal stage; unique stage ids; globally unique
artifact/evidence names; transition targets exist; non-terminal stages have a
way out (global transitions count); gate references resolve; `findings-clear`
targets `kind: findings`; `artifact-fresh` targets need `reviews:`; reviews
links acyclic; artifact schemas compile; every stage reachable from initial.
Warnings: terminal stages with transitions, workflow/method stages without
`resultEvidence`, stages from which no terminal is reachable.

## Sharing stages across factories

Definitions are CEL-evaluated by the platform, so a team template instance
can hold the canonical stages and other factory instances can reference it:

```yaml
globalArguments:
  stages: "${{ model.acme-sdlc-template.definition.globalArguments.stages }}"
```

## Scoping the work-item summary report

The extension ships a `@adam/software-factory/work-item-summary` report (a
model-type default) that persists the `summary` method's markdown history
through swamp's report machinery. Method-scope reports run after **every**
method and persist even empty results, so an unscoped default buries the
stored summaries under empty placeholder versions from `record_artifact`,
`advance`, etc. Standard practice — like `checks: { require: [...] }` — is
to scope it in the definition file (a top-level key, sibling of
`globalArguments`):

```yaml
reports:
  require:
    - { name: "@adam/software-factory/work-item-summary", methods: [summary] }
```

With this, the report fires only after `summary`, every stored version is a
real history, and `require` makes it immune to `--skip-reports`.
