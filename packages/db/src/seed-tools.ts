/**
 * Seed 25 real FIRST Robotics tools directly into the database.
 * Bypasses the ingestion pipeline — treats these as manually curated records.
 *
 * Run with: npx tsx src/seed-tools.ts
 *
 * Safe to re-run: slugs use onConflictDoNothing.
 */
import { getDb } from './client'
import {
  tools,
  toolLinks,
  toolPrograms,
  toolAudiencePrimaryRoles,
  toolAudienceFunctions,
  toolSources,
  programs,
  audiencePrimaryRoles,
  audienceFunctions,
} from './schema/index'
import { eq, inArray } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface SeedTool {
  slug: string
  name: string
  summary: string
  toolType: string
  isOfficial: boolean
  isVendor: boolean
  isRookieFriendly: boolean
  freshnessState: string
  programs: string[]         // program slugs: frc | ftc | fll
  audienceRoles: string[]    // role slugs
  audienceFunctions: string[]
  homepage?: string
  github?: string
  docs?: string
}

const SEED_TOOLS: SeedTool[] = [
  // ---------------------------------------------------------------------------
  // FRC — Scouting & Data
  // ---------------------------------------------------------------------------
  {
    slug: 'the-blue-alliance',
    name: 'The Blue Alliance',
    summary:
      'The go-to source for FRC match results, rankings, event schedules, and team statistics. Covers every FRC event since 2002 and powers many scouting apps via its API.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['scouter', 'strategist'],
    homepage: 'https://www.thebluealliance.com',
  },
  {
    slug: 'statbotics',
    name: 'Statbotics',
    summary:
      'Advanced FRC statistics platform featuring EPA (Expected Points Added) ratings for teams and events. Useful for pre-event analysis and alliance selection research.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['scouter', 'strategist'],
    homepage: 'https://www.statbotics.io',
    github: 'https://github.com/avgupta456/statbotics',
  },
  {
    slug: 'scoutingpass',
    name: 'ScoutingPASS',
    summary:
      'QR-code-based FRC scouting system. Teams configure a JSON file to define their scouting sheet; apps generate QR codes that can be scanned into a spreadsheet without internet.',
    toolType: 'github_project',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['scouter', 'strategist'],
    github: 'https://github.com/scouting-PASS/ScoutingPASS',
  },

  // ---------------------------------------------------------------------------
  // FRC — Autonomous & Path Planning
  // ---------------------------------------------------------------------------
  {
    slug: 'pathplanner',
    name: 'PathPlanner',
    summary:
      'Desktop app for designing and generating FRC autonomous paths. Supports holonomic and differential drivetrains, event markers, and path constraints. Widely used across teams.',
    toolType: 'desktop_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    homepage: 'https://pathplanner.dev',
    github: 'https://github.com/mjansen4857/pathplanner',
  },
  {
    slug: 'choreo',
    name: 'Choreo',
    summary:
      'Trajectory optimizer for FRC robots. Uses physics-based optimization to generate time-optimal paths that respect wheel force limits, producing smoother and faster autos than geometric planners.',
    toolType: 'desktop_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    homepage: 'https://choreo.autos',
    github: 'https://github.com/SleipnirGroup/Choreo',
  },

  // ---------------------------------------------------------------------------
  // FRC — Vision
  // ---------------------------------------------------------------------------
  {
    slug: 'photonvision',
    name: 'PhotonVision',
    summary:
      'Open-source FRC vision processing pipeline that runs on a coprocessor (Raspberry Pi, Orange Pi, etc.). Detects AprilTags and game pieces; integrates with WPILib pose estimation.',
    toolType: 'github_project',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer', 'electrical'],
    homepage: 'https://photonvision.org',
    github: 'https://github.com/PhotonVision/photonvision',
    docs: 'https://docs.photonvision.org',
  },
  {
    slug: 'limelight',
    name: 'Limelight',
    summary:
      'Plug-and-play FRC vision camera with an integrated web dashboard for configuration. Supports AprilTag tracking, neural network pipelines, and returns target data directly over NetworkTables.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: true,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer', 'electrical'],
    homepage: 'https://limelightvision.io',
    docs: 'https://docs.limelightvision.io',
  },

  // ---------------------------------------------------------------------------
  // FRC — Telemetry & Debugging
  // ---------------------------------------------------------------------------
  {
    slug: 'advantagescope',
    name: 'AdvantageScope',
    summary:
      'Desktop telemetry viewer and log analyzer for FRC robots. Supports WPILib DataLog files, live NetworkTables streaming, 3D field visualization, and custom dashboard tabs.',
    toolType: 'desktop_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    github: 'https://github.com/Mechanical-Advantage/AdvantageScope',
  },

  // ---------------------------------------------------------------------------
  // FRC — Programming Framework & Libraries
  // ---------------------------------------------------------------------------
  {
    slug: 'wpilib',
    name: 'WPILib',
    summary:
      'The official FRC robot programming library for Java and C++. Provides hardware abstraction (motors, sensors, cameras), control algorithms, simulation, and the VS Code development environment.',
    toolType: 'resource',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    homepage: 'https://wpilib.org',
    github: 'https://github.com/wpilibsuite/allwpilib',
    docs: 'https://docs.wpilib.org',
  },
  {
    slug: 'rev-hardware-client',
    name: 'REV Hardware Client',
    summary:
      'Desktop application for configuring and updating REV Robotics devices (SPARK MAX, SPARK Flex, Power Distribution Hub). Also provides real-time telemetry and motor tuning.',
    toolType: 'desktop_app',
    isOfficial: false,
    isVendor: true,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer', 'electrical'],
    homepage: 'https://docs.revrobotics.com/rev-hardware-client',
    docs: 'https://docs.revrobotics.com/rev-hardware-client',
  },

  // ---------------------------------------------------------------------------
  // FRC — Design Resources
  // ---------------------------------------------------------------------------
  {
    slug: 'frcdesign-org',
    name: 'FRCDesign.org',
    summary:
      'Comprehensive mechanical design guide for FRC teams. Covers drivetrain design, game piece mechanisms, CAD practices, and manufacturing. Includes worked examples and Onshape templates.',
    toolType: 'resource',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['cad', 'mechanical'],
    homepage: 'https://www.frcdesign.org',
  },

  // ---------------------------------------------------------------------------
  // FRC — Event & Queue Management
  // ---------------------------------------------------------------------------
  {
    slug: 'frc-nexus',
    name: 'FRC Nexus',
    summary:
      'Event management tool for FRC competitions. Provides team queuing, pit scouting forms, and match-day communication tools. Used by event staff to keep pit and queuing areas running smoothly.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['volunteer', 'organizer_staff'],
    audienceFunctions: ['event_ops'],
    homepage: 'https://frc-nexus.com',
  },

  // ---------------------------------------------------------------------------
  // FRC — Official Data
  // ---------------------------------------------------------------------------
  {
    slug: 'frc-events-api',
    name: 'FRC Events API',
    summary:
      'Official FIRST Robotics Competition event data API. Provides real-time match results, team rankings, event schedules, and team data for all FRC seasons.',
    toolType: 'api',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['mentor', 'organizer_staff'],
    audienceFunctions: ['event_ops'],
    homepage: 'https://frc-events.firstinspires.org/services/API',
    docs: 'https://frc-events.firstinspires.org/services/API',
  },

  // ---------------------------------------------------------------------------
  // FTC — Data & Scouting
  // ---------------------------------------------------------------------------
  {
    slug: 'ftcscout',
    name: 'FTCScout',
    summary:
      'FTC equivalent of The Blue Alliance. Tracks team statistics, match results, and rankings across FTC events. Includes OPR/NP calculations and team-level breakdowns.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['ftc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['scouter', 'strategist'],
    homepage: 'https://ftcscout.org',
    github: 'https://github.com/ftcscout/ftcscout',
  },

  // ---------------------------------------------------------------------------
  // FTC — Autonomous & Path Planning
  // ---------------------------------------------------------------------------
  {
    slug: 'road-runner',
    name: 'Road Runner',
    summary:
      'Motion profiling library for FTC robots. Generates smooth, time-optimal trajectories for mecanum and tank drivetrains. The dominant FTC autonomous library; requires tuning but delivers reliable paths.',
    toolType: 'github_project',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['ftc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    github: 'https://github.com/acmerobotics/road-runner',
    docs: 'https://rr.brott.dev/docs',
  },
  {
    slug: 'pedro-pathing',
    name: 'Pedro Pathing',
    summary:
      'Alternative FTC autonomous path follower designed for reactive, on-the-fly path correction. Uses a centripetal force correction approach for smooth, consistent holonomic robot movement.',
    toolType: 'github_project',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['ftc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    github: 'https://github.com/Pedro-Pathing/PedroPathing',
    docs: 'https://pedro-pathing.com/docs',
  },

  // ---------------------------------------------------------------------------
  // FTC — Telemetry & Debugging
  // ---------------------------------------------------------------------------
  {
    slug: 'ftc-dashboard',
    name: 'FTC Dashboard',
    summary:
      'Browser-based real-time dashboard for FTC robots. Displays live telemetry, graphs, and camera feeds during development. Allows changing configuration variables without redeploying code.',
    toolType: 'github_project',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['ftc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    github: 'https://github.com/acmerobotics/ftc-dashboard',
    docs: 'https://acmerobotics.github.io/ftc-dashboard',
  },

  // ---------------------------------------------------------------------------
  // FTC — Vision
  // ---------------------------------------------------------------------------
  {
    slug: 'eocv-sim',
    name: 'EOCV-Sim',
    summary:
      'OpenCV simulation environment for FTC vision pipelines. Run and debug EasyOpenCV pipelines on a desktop without a robot. Supports live camera feeds and image injection for testing.',
    toolType: 'github_project',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['ftc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['programmer'],
    github: 'https://github.com/deltacv/EOCV-Sim',
  },

  // ---------------------------------------------------------------------------
  // FTC — Official Data
  // ---------------------------------------------------------------------------
  {
    slug: 'ftc-event-results',
    name: 'FTC Event Results',
    summary:
      'Official FIRST Tech Challenge event results portal. View match scores, team rankings, and awards for all FTC events worldwide. Maintained by FIRST.',
    toolType: 'web_app',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['ftc'],
    audienceRoles: ['student', 'mentor', 'parent_newcomer'],
    audienceFunctions: ['scouter'],
    homepage: 'https://ftc-events.firstinspires.org',
  },

  // ---------------------------------------------------------------------------
  // FLL
  // ---------------------------------------------------------------------------
  {
    slug: 'fll-challenge-scoring',
    name: 'FLL Challenge Scoring App',
    summary:
      'Official FIRST LEGO League Challenge scoring application used by referees at qualifying and championship events. Implements the season-specific Robot Game scoring missions.',
    toolType: 'web_app',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['fll'],
    audienceRoles: ['volunteer', 'organizer_staff'],
    audienceFunctions: ['judging', 'event_ops'],
    homepage: 'https://firstlegoleague.org',
  },
  {
    slug: 'first-inspires-dashboard',
    name: 'FIRST Inspires Team Dashboard',
    summary:
      'Official FIRST team management portal. Register teams, manage member rosters, track required consent forms, and access program resources across FRC, FTC, and FLL.',
    toolType: 'web_app',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc', 'ftc', 'fll'],
    audienceRoles: ['mentor', 'organizer_staff'],
    audienceFunctions: ['team_management'],
    homepage: 'https://www.firstinspires.org',
  },
  {
    slug: 'fll-explorer-resources',
    name: 'FLL Explorer Resources',
    summary:
      'Official FIRST LEGO League Explore resource hub. Contains season challenge guides, judging rubrics, team meeting resources, and coach materials for the entry-level FLL program.',
    toolType: 'resource',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['fll'],
    audienceRoles: ['mentor', 'parent_newcomer'],
    audienceFunctions: ['team_management', 'outreach'],
    homepage: 'https://firstlegoleague.org',
  },
  {
    slug: 'fll-tournament-manager',
    name: 'FLL Tournament Manager',
    summary:
      'Desktop tournament management software for running FLL events. Handles team check-in, match scheduling, scoring entry, and display screens. Provided by FIRST to event organizers.',
    toolType: 'desktop_app',
    isOfficial: true,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['fll'],
    audienceRoles: ['volunteer', 'organizer_staff'],
    audienceFunctions: ['event_ops'],
    homepage: 'https://firstlegoleague.org',
  },

  // ---------------------------------------------------------------------------
  // Volunteer & Event Tools
  // ---------------------------------------------------------------------------
  {
    slug: 'fta-buddy',
    name: 'FTA Buddy',
    summary:
      'Field support tool for FRC FTAs and FTAAs. Tracks field faults, team connection issues, and match history during events. Helps FTAs quickly diagnose and document recurring problems.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc'],
    audienceRoles: ['volunteer'],
    audienceFunctions: ['field_technical'],
    homepage: 'https://ftabuddy.com',
  },
  {
    slug: 'volunteer-systems',
    name: 'Volunteer Systems',
    summary:
      'Volunteer scheduling and management platform used by FIRST event organizers. Allows volunteers to sign up for event roles, tracks assignments, and sends event communications.',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: false,
    isRookieFriendly: false,
    freshnessState: 'active',
    programs: ['frc', 'ftc', 'fll'],
    audienceRoles: ['volunteer', 'organizer_staff'],
    audienceFunctions: ['event_ops'],
    homepage: 'https://volunteersystems.org',
  },
  {
    slug: 'onshape',
    name: 'Onshape',
    summary:
      'Browser-based professional CAD platform heavily adopted by FRC and FTC teams. Supports real-time collaboration, version history, and a large library of FIRST-specific part libraries (MKCAD, etc.).',
    toolType: 'web_app',
    isOfficial: false,
    isVendor: true,
    isRookieFriendly: true,
    freshnessState: 'active',
    programs: ['frc', 'ftc'],
    audienceRoles: ['student', 'mentor'],
    audienceFunctions: ['cad', 'mechanical'],
    homepage: 'https://www.onshape.com',
    docs: 'https://learn.onshape.com',
  },
]

// ---------------------------------------------------------------------------
// Insert logic
// ---------------------------------------------------------------------------

async function seedTools() {
  const db = getDb()

  // Load reference tables once
  const programRows = await db.select({ id: programs.id, slug: programs.slug }).from(programs)
  const roleRows = await db.select({ id: audiencePrimaryRoles.id, slug: audiencePrimaryRoles.slug }).from(audiencePrimaryRoles)
  const fnRows = await db.select({ id: audienceFunctions.id, slug: audienceFunctions.slug }).from(audienceFunctions)

  const programBySlug = new Map(programRows.map((r) => [r.slug, r.id]))
  const roleBySlug = new Map(roleRows.map((r) => [r.slug, r.id]))
  const fnBySlug = new Map(fnRows.map((r) => [r.slug, r.id]))

  let inserted = 0
  let skipped = 0

  for (const tool of SEED_TOOLS) {
    // Skip if slug already exists
    const [existing] = await db
      .select({ id: tools.id })
      .from(tools)
      .where(eq(tools.slug, tool.slug))
      .limit(1)

    if (existing) {
      console.log(`  skip  ${tool.slug}`)
      skipped++
      continue
    }

    const [newTool] = await db
      .insert(tools)
      .values({
        slug: tool.slug,
        name: tool.name,
        summary: tool.summary,
        toolType: tool.toolType,
        status: 'published',
        isOfficial: tool.isOfficial,
        isVendor: tool.isVendor,
        isRookieFriendly: tool.isRookieFriendly,
        freshnessState: tool.freshnessState,
        confidenceScore: 1.0,
        popularityScore: 0,
        publishedAt: new Date(),
      })
      .returning({ id: tools.id })

    const toolId = newTool.id

    // Links
    if (tool.homepage) {
      await db.insert(toolLinks).values({ toolId, linkType: 'homepage', url: tool.homepage })
    }
    if (tool.github) {
      await db.insert(toolLinks).values({ toolId, linkType: 'github', url: tool.github })
    }
    if (tool.docs) {
      await db.insert(toolLinks).values({ toolId, linkType: 'docs', url: tool.docs })
    }

    // Programs
    const progIds = tool.programs.map((s) => programBySlug.get(s)).filter(Boolean) as number[]
    if (progIds.length > 0) {
      await db.insert(toolPrograms).values(progIds.map((programId) => ({ toolId, programId })))
    }

    // Audience roles
    const roleIds = tool.audienceRoles.map((s) => roleBySlug.get(s)).filter(Boolean) as number[]
    if (roleIds.length > 0) {
      await db.insert(toolAudiencePrimaryRoles).values(roleIds.map((roleId) => ({ toolId, roleId })))
    }

    // Audience functions
    const fnIds = tool.audienceFunctions.map((s) => fnBySlug.get(s)).filter(Boolean) as number[]
    if (fnIds.length > 0) {
      await db.insert(toolAudienceFunctions).values(fnIds.map((functionId) => ({ toolId, functionId })))
    }

    // Source record
    await db.insert(toolSources).values({
      toolId,
      sourceType: 'manual',
      notes: 'Seeded manually from curated list',
    })

    console.log(`  insert ${tool.slug}`)
    inserted++
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`)
}

seedTools()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => process.exit(0))
