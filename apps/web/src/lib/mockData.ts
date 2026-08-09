import type {
  Meeting,
  DashboardStats,
  SearchResult,
} from './types';

// ─── Helper ───────────────────────────────────────────────────────────────────

function ts(m: number, s: number): number {
  return m * 60 + s;
}

// ─── Mock Meetings ────────────────────────────────────────────────────────────

export const MOCK_MEETINGS: Meeting[] = [
  {
    id: 'meeting_001',
    title: 'Enterprise License Discussion — TechCorp',
    customerName: 'Arjun Mehta',
    customerCompany: 'TechCorp Solutions',
    date: '2026-08-09T10:00:00Z',
    duration: ts(38, 14),
    status: 'completed',
    processingMode: 'accurate',
    sentiment: 'positive',
    purchaseIntent: 'very_high',
    tags: ['enterprise', 'pricing', 'negotiation'],
    summary: {
      objective: 'Discuss enterprise license pricing and deployment timeline for 5,000-seat rollout.',
      overview:
        'A productive meeting focused on finalising the enterprise licensing deal. The customer showed strong purchase intent and was primarily concerned about pricing and deployment timeline. A 15% discount was tentatively agreed upon pending management approval.',
      keyPoints: [
        'Customer requires 5,000 licenses for India + Southeast Asia deployment',
        'Current vendor contract expires end of Q3',
        'Customer is comparing SSMI with two competitors',
        'Technical integration with Salesforce is a hard requirement',
        'Decision expected within 2 weeks',
      ],
      decisions: [
        '15% discount to be offered pending management sign-off',
        'POC deployment of 50 seats agreed for next month',
        'Technical demo scheduled for 19th August',
      ],
      risks: [
        'Competitor "VoiceAI Pro" is offering aggressive pricing',
        'Procurement cycle may delay signing beyond Q3',
      ],
      customerSentiment: 'positive',
      purchaseIntent: 'very_high',
      nextSteps: [
        'Send revised pricing proposal by EOD Friday',
        'Schedule technical demo for 19 August',
        'Arrange Salesforce integration call with engineering team',
        'Share case study of similar enterprise deployment',
      ],
    },
    timeline: [
      {
        id: 'evt_001',
        meetingId: 'meeting_001',
        type: 'REQUIREMENT',
        title: 'License Requirement — 5000 Seats',
        description: 'Customer clearly stated their need for 5,000 enterprise licenses across India and SEA markets.',
        startTime: ts(2, 14),
        endTime: ts(3, 1),
        speaker: 'CUSTOMER',
        importance: 4,
        confidence: 0.97,
        evidence: [
          '"We need around 5,000 licenses to cover our India and Southeast Asia operations."',
          '"The rollout has to be complete before end of Q3."',
        ],
        purchaseIntent: 'high',
        entities: ['5000 licenses', 'India', 'Southeast Asia', 'Q3'],
      },
      {
        id: 'evt_002',
        meetingId: 'meeting_001',
        type: 'BUDGET',
        title: 'Budget Range Disclosed',
        description: 'Customer disclosed a budget of $120,000 annually for the platform.',
        startTime: ts(8, 30),
        endTime: ts(9, 42),
        speaker: 'CUSTOMER',
        importance: 5,
        confidence: 0.94,
        evidence: [
          '"Our annual software budget for this kind of tool is around $120,000."',
          '"That includes implementation and support."',
        ],
        purchaseIntent: 'very_high',
        entities: ['$120,000', 'annual budget'],
      },
      {
        id: 'evt_003',
        meetingId: 'meeting_001',
        type: 'OBJECTION',
        title: 'Competitor Pricing Objection',
        description: 'Customer mentioned competitor VoiceAI Pro is offering a lower price point.',
        startTime: ts(15, 20),
        endTime: ts(16, 10),
        speaker: 'CUSTOMER',
        importance: 5,
        confidence: 0.96,
        evidence: [
          '"VoiceAI Pro is quoting us almost 20% less for a comparable feature set."',
          '"We need you to match or beat that to move forward."',
        ],
        purchaseIntent: 'high',
        entities: ['VoiceAI Pro', '20% discount'],
      },
      {
        id: 'evt_004',
        meetingId: 'meeting_001',
        type: 'NEGOTIATION',
        title: 'Discount Negotiation — 15% Request',
        description: 'Customer requested a 15% discount in exchange for signing this month.',
        startTime: ts(22, 8),
        endTime: ts(23, 55),
        speaker: 'CUSTOMER',
        importance: 5,
        confidence: 0.98,
        evidence: [
          '"If you can give us 15% off, we\'ll sign the contract this month."',
          '"That would make it a straightforward decision for my management."',
        ],
        purchaseIntent: 'very_high',
        entities: ['15% discount', 'this month'],
      },
      {
        id: 'evt_005',
        meetingId: 'meeting_001',
        type: 'DECISION',
        title: 'POC Agreement — 50 Seats',
        description: 'Both parties agreed on a 50-seat POC deployment next month.',
        startTime: ts(31, 40),
        endTime: ts(32, 55),
        speaker: 'SALESPERSON',
        importance: 4,
        confidence: 0.95,
        evidence: [
          '"We\'ll set up a 50-seat pilot for your core sales team next month."',
          '"That gives you 30 days to evaluate the platform in your environment."',
        ],
        purchaseIntent: 'very_high',
        entities: ['50 seats', 'POC', 'pilot'],
        bookmarked: true,
      },
    ],
    actionItems: [
      {
        id: 'act_001',
        meetingId: 'meeting_001',
        title: 'Send revised pricing proposal',
        description: 'Include 15% discount option pending management approval.',
        owner: 'SALESPERSON',
        deadline: '2026-08-14',
        confidence: 0.97,
        evidenceTimestamp: ts(23, 55),
        completed: false,
        priority: 'high',
      },
      {
        id: 'act_002',
        meetingId: 'meeting_001',
        title: 'Schedule technical demo',
        description: 'Arrange demo on 19th August with engineering team present.',
        owner: 'SALESPERSON',
        deadline: '2026-08-19',
        confidence: 0.94,
        evidenceTimestamp: ts(32, 10),
        completed: false,
        priority: 'high',
      },
      {
        id: 'act_003',
        meetingId: 'meeting_001',
        title: 'Share Salesforce integration documentation',
        description: 'Customer specifically asked for Salesforce API integration specs.',
        owner: 'SALESPERSON',
        deadline: '2026-08-12',
        confidence: 0.91,
        evidenceTimestamp: ts(18, 30),
        completed: true,
        priority: 'medium',
      },
      {
        id: 'act_004',
        meetingId: 'meeting_001',
        title: 'Share enterprise deployment case study',
        description: 'Send similar enterprise use case to build credibility.',
        owner: 'SALESPERSON',
        deadline: '2026-08-14',
        confidence: 0.88,
        evidenceTimestamp: ts(27, 15),
        completed: false,
        priority: 'medium',
      },
    ],
    transcript: [
      { id: 'seg_001', speaker: 'SALESPERSON', startTime: ts(0, 0), endTime: ts(0, 42), text: 'Good morning Arjun! Thanks for making time today. I know you\'ve been looking at a few platforms to support your sales team intelligence needs.', confidence: 0.98, },
      { id: 'seg_002', speaker: 'CUSTOMER', startTime: ts(0, 43), endTime: ts(1, 20), text: 'Yes, absolutely. We\'ve been evaluating three or four tools over the past couple of months. SSMI came highly recommended from a few contacts in the industry.', confidence: 0.97, },
      { id: 'seg_003', speaker: 'SALESPERSON', startTime: ts(1, 21), endTime: ts(2, 10), text: 'That\'s great to hear. Can you give me a sense of the scale you\'re thinking? Number of seats, geographies involved?', confidence: 0.98, },
      { id: 'seg_004', speaker: 'CUSTOMER', startTime: ts(2, 14), endTime: ts(3, 1), text: 'We need around 5,000 licenses to cover our India and Southeast Asia operations. The rollout has to be complete before end of Q3.', confidence: 0.97, eventId: 'evt_001', },
      { id: 'seg_005', speaker: 'SALESPERSON', startTime: ts(3, 5), endTime: ts(4, 0), text: 'Understood. That\'s a significant deployment. We have experience with several enterprise rollouts at that scale. What\'s driving the Q3 deadline specifically?', confidence: 0.98, },
      { id: 'seg_006', speaker: 'CUSTOMER', startTime: ts(4, 5), endTime: ts(5, 30), text: 'Our current vendor contract expires in September. We want to have the new platform running before that so we don\'t have any productivity gap for the sales team.', confidence: 0.96, },
      { id: 'seg_007', speaker: 'SALESPERSON', startTime: ts(5, 35), endTime: ts(7, 10), text: 'That makes sense. We\'ve done migrations like this before — we can actually run both platforms in parallel for a transition period so there\'s zero disruption. Let me talk about the pricing structure for an enterprise account of this size.', confidence: 0.97, },
      { id: 'seg_008', speaker: 'CUSTOMER', startTime: ts(8, 30), endTime: ts(9, 42), text: 'Before we get into pricing, I should mention our annual software budget for this kind of tool is around $120,000. That includes implementation and support.', confidence: 0.95, eventId: 'evt_002', },
      { id: 'seg_009', speaker: 'SALESPERSON', startTime: ts(9, 45), endTime: ts(11, 0), text: 'Good to know. Our standard enterprise pricing for 5,000 seats comes in at $142,000 annually with full support and implementation included. We have some flexibility there.', confidence: 0.97, },
      { id: 'seg_010', speaker: 'CUSTOMER', startTime: ts(15, 20), endTime: ts(16, 10), text: 'I have to be direct with you — VoiceAI Pro is quoting us almost 20% less for a comparable feature set. We need you to match or beat that to move forward.', confidence: 0.96, eventId: 'evt_003', },
      { id: 'seg_011', speaker: 'SALESPERSON', startTime: ts(16, 12), endTime: ts(17, 30), text: 'I appreciate you being direct. Let me be direct as well — I think our AI accuracy, particularly the evidence-based timeline generation, significantly outperforms VoiceAI Pro. But I hear you on the price sensitivity. Let me see what I can put together.', confidence: 0.97, },
      { id: 'seg_012', speaker: 'CUSTOMER', startTime: ts(22, 8), endTime: ts(23, 55), text: 'If you can give us 15% off, we\'ll sign the contract this month. That would make it a straightforward decision for my management.', confidence: 0.98, eventId: 'evt_004', },
      { id: 'seg_013', speaker: 'SALESPERSON', startTime: ts(24, 0), endTime: ts(25, 15), text: 'A 15% reduction brings us to about $120,700. That\'s very close to your stated budget. I\'ll need to get a quick sign-off from my director but I\'m confident we can make that work for an enterprise commitment of this size.', confidence: 0.97, },
      { id: 'seg_014', speaker: 'CUSTOMER', startTime: ts(25, 20), endTime: ts(26, 10), text: 'Good. And what about Salesforce integration? That\'s a hard requirement. Our entire CRM workflow runs through Salesforce.', confidence: 0.97, },
      { id: 'seg_015', speaker: 'SALESPERSON', startTime: ts(31, 40), endTime: ts(32, 55), text: 'Here\'s what I propose — we\'ll set up a 50-seat pilot for your core sales team next month. That gives you 30 days to evaluate the platform in your own environment before the full rollout.', confidence: 0.98, eventId: 'evt_005', },
    ],
  },
  {
    id: 'meeting_002',
    title: 'Product Demo — Fintech Startup',
    customerName: 'Priya Sharma',
    customerCompany: 'PaySmart Technologies',
    date: '2026-08-07T14:30:00Z',
    duration: ts(22, 45),
    status: 'completed',
    processingMode: 'fast',
    sentiment: 'neutral',
    purchaseIntent: 'medium',
    tags: ['demo', 'startup', 'budget_concern'],
    summary: {
      objective: 'Product demonstration for SSMI to the PaySmart sales leadership team.',
      overview:
        'Product demo went well with strong engagement on the AI timeline feature. Budget remains a concern for this early-stage startup. Follow-up required with a startup pricing tier.',
      keyPoints: [
        'Team of 8 sales reps currently using manual notes',
        'Impressed by AI timeline and voice bookmark feature',
        'Budget constraint around $8,000 annually',
        'Interested in startup pricing tier',
      ],
      decisions: ['Share startup pricing details', 'Free trial period to be offered'],
      risks: ['Budget may be insufficient for standard tier', 'No dedicated IT for deployment'],
      customerSentiment: 'neutral',
      purchaseIntent: 'medium',
      nextSteps: [
        'Send startup pricing proposal',
        'Offer 14-day free trial',
        'Schedule follow-up in 2 weeks',
      ],
    },
    timeline: [
      {
        id: 'evt_010',
        meetingId: 'meeting_002',
        type: 'REQUIREMENT',
        title: 'Team Size — 8 Sales Reps',
        description: 'Customer needs platform for a team of 8 sales representatives.',
        startTime: ts(3, 10),
        endTime: ts(4, 5),
        speaker: 'CUSTOMER',
        importance: 3,
        confidence: 0.95,
        evidence: ['"We have 8 sales reps and currently everyone uses their own notes system."'],
        purchaseIntent: 'medium',
        entities: ['8 sales reps'],
      },
      {
        id: 'evt_011',
        meetingId: 'meeting_002',
        type: 'BUDGET',
        title: 'Budget Constraint — $8,000/year',
        description: 'Customer has a tight annual software budget constraint.',
        startTime: ts(12, 20),
        endTime: ts(13, 15),
        speaker: 'CUSTOMER',
        importance: 4,
        confidence: 0.93,
        evidence: ['"As a startup we\'re budget-conscious. $8,000 a year is about our ceiling."'],
        purchaseIntent: 'medium',
        entities: ['$8,000', 'startup budget'],
      },
    ],
    actionItems: [
      {
        id: 'act_010',
        meetingId: 'meeting_002',
        title: 'Send startup pricing proposal',
        description: 'Create a special startup tier proposal for teams under 10 users.',
        owner: 'SALESPERSON',
        deadline: '2026-08-10',
        confidence: 0.92,
        completed: true,
        priority: 'high',
      },
    ],
    transcript: [
      { id: 'seg_020', speaker: 'SALESPERSON', startTime: ts(0, 0), endTime: ts(0, 30), text: 'Hi Priya, welcome to the SSMI demo. Let me walk you through the platform.', confidence: 0.98 },
      { id: 'seg_021', speaker: 'CUSTOMER', startTime: ts(0, 32), endTime: ts(1, 10), text: 'Thanks! We\'ve been struggling with keeping consistent meeting notes across our sales team.', confidence: 0.97 },
      { id: 'seg_022', speaker: 'CUSTOMER', startTime: ts(3, 10), endTime: ts(4, 5), text: 'We have 8 sales reps and currently everyone uses their own notes system. It\'s a mess.', confidence: 0.96, eventId: 'evt_010' },
      { id: 'seg_023', speaker: 'CUSTOMER', startTime: ts(12, 20), endTime: ts(13, 15), text: 'As a startup we\'re budget-conscious. $8,000 a year is about our ceiling for this kind of tool.', confidence: 0.95, eventId: 'evt_011' },
    ],
  },
  {
    id: 'meeting_003',
    title: 'Annual Renewal Discussion — ManuCorp',
    customerName: 'Vikram Nair',
    customerCompany: 'ManuCorp India',
    date: '2026-08-05T11:00:00Z',
    duration: ts(18, 30),
    status: 'completed',
    processingMode: 'accurate',
    sentiment: 'positive',
    purchaseIntent: 'very_high',
    tags: ['renewal', 'upsell', 'enterprise'],
    summary: {
      objective: 'Annual contract renewal and discuss upsell opportunity for additional modules.',
      overview: 'Existing customer very satisfied with platform. Renewal confirmed. Upsell opportunity identified for analytics module.',
      keyPoints: [
        'Current 200-seat license up for renewal',
        'Strong satisfaction with AI timeline feature',
        'Interest in analytics dashboard add-on',
        'Budget approved for renewal',
      ],
      decisions: ['Renewal confirmed at current pricing', 'Analytics module demo to be scheduled'],
      risks: [],
      customerSentiment: 'positive',
      purchaseIntent: 'very_high',
      nextSteps: [
        'Send renewal contract',
        'Schedule analytics dashboard demo',
      ],
    },
    timeline: [
      {
        id: 'evt_020',
        meetingId: 'meeting_003',
        type: 'DECISION',
        title: 'Contract Renewal Confirmed',
        description: 'Customer confirmed renewal of 200-seat license for another year.',
        startTime: ts(5, 30),
        endTime: ts(6, 45),
        speaker: 'CUSTOMER',
        importance: 5,
        confidence: 0.99,
        evidence: ['"Yes, we\'re definitely renewing. The platform has saved our team countless hours."'],
        purchaseIntent: 'very_high',
        entities: ['200 seats', 'renewal'],
      },
      {
        id: 'evt_021',
        meetingId: 'meeting_003',
        type: 'PURCHASE_INTENT',
        title: 'Interest in Analytics Module',
        description: 'Customer expressed interest in upgrading to include the analytics add-on.',
        startTime: ts(11, 0),
        endTime: ts(12, 30),
        speaker: 'CUSTOMER',
        importance: 4,
        confidence: 0.93,
        evidence: ['"We\'d love to see the team analytics dashboard — can you show that to us?"'],
        purchaseIntent: 'high',
        entities: ['analytics dashboard', 'add-on'],
      },
    ],
    actionItems: [
      {
        id: 'act_020',
        meetingId: 'meeting_003',
        title: 'Send renewal contract',
        description: 'Prepare and send the annual renewal agreement for 200 seats.',
        owner: 'SALESPERSON',
        deadline: '2026-08-08',
        confidence: 0.99,
        completed: true,
        priority: 'high',
      },
    ],
    transcript: [
      { id: 'seg_030', speaker: 'SALESPERSON', startTime: ts(0, 0), endTime: ts(0, 30), text: 'Hi Vikram, great to reconnect. Time flies — already a year with SSMI!', confidence: 0.98 },
      { id: 'seg_031', speaker: 'CUSTOMER', startTime: ts(0, 32), endTime: ts(1, 45), text: 'It really has. I\'ll be honest, this was one of the best software decisions we made last year. The AI timeline has been a game changer for our team.', confidence: 0.97 },
      { id: 'seg_032', speaker: 'CUSTOMER', startTime: ts(5, 30), endTime: ts(6, 45), text: 'Yes, we\'re definitely renewing. The platform has saved our team countless hours. Budget\'s already approved.', confidence: 0.99, eventId: 'evt_020' },
      { id: 'seg_033', speaker: 'CUSTOMER', startTime: ts(11, 0), endTime: ts(12, 30), text: 'We\'d love to see the team analytics dashboard — can you show that to us? We\'ve been looking for a way to give managers visibility across all rep meetings.', confidence: 0.96, eventId: 'evt_021' },
    ],
  },
];

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export const MOCK_STATS: DashboardStats = {
  totalMeetings: 47,
  totalActionItems: 142,
  avgMeetingMinutes: 28,
  hoursSaved: 31,
  meetingsThisWeek: 6,
  conversionRate: 68,
};

// ─── Search Results ───────────────────────────────────────────────────────────

export const MOCK_SEARCH_RESULTS: SearchResult[] = [
  {
    meetingId: 'meeting_001',
    meetingTitle: 'Enterprise License Discussion — TechCorp',
    customerName: 'Arjun Mehta',
    customerCompany: 'TechCorp Solutions',
    date: '2026-08-09T10:00:00Z',
    eventType: 'OBJECTION',
    snippet: '"VoiceAI Pro is quoting us almost 20% less for a comparable feature set. We need you to match or beat that to move forward."',
    startTime: ts(15, 20),
    importance: 5,
    confidence: 0.96,
  },
  {
    meetingId: 'meeting_002',
    meetingTitle: 'Product Demo — Fintech Startup',
    customerName: 'Priya Sharma',
    customerCompany: 'PaySmart Technologies',
    date: '2026-08-07T14:30:00Z',
    eventType: 'BUDGET',
    snippet: '"As a startup we\'re budget-conscious. $8,000 a year is about our ceiling for this kind of tool."',
    startTime: ts(12, 20),
    importance: 4,
    confidence: 0.93,
  },
  {
    meetingId: 'meeting_003',
    meetingTitle: 'Annual Renewal Discussion — ManuCorp',
    customerName: 'Vikram Nair',
    customerCompany: 'ManuCorp India',
    date: '2026-08-05T11:00:00Z',
    eventType: 'DECISION',
    snippet: '"Yes, we\'re definitely renewing. The platform has saved our team countless hours. Budget\'s already approved."',
    startTime: ts(5, 30),
    importance: 5,
    confidence: 0.99,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return `${h}h ${rem}m`;
  }
  return `${m}m ${s > 0 ? s + 's' : ''}`.trim();
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function getMeetingById(id: string): Meeting | undefined {
  return MOCK_MEETINGS.find((m) => m.id === id);
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  REQUIREMENT: 'Requirement',
  PRICING: 'Pricing',
  BUDGET: 'Budget',
  OBJECTION: 'Objection',
  NEGOTIATION: 'Negotiation',
  DECISION: 'Decision',
  ACTION_ITEM: 'Action Item',
  COMPETITOR: 'Competitor',
  COMMITMENT: 'Commitment',
  RISK: 'Risk',
  PURCHASE_INTENT: 'Purchase Intent',
};

export const EVENT_TYPE_COLORS: Record<string, string> = {
  REQUIREMENT: '#4f8ef7',
  PRICING: '#f59e0b',
  BUDGET: '#f59e0b',
  OBJECTION: '#ef4444',
  NEGOTIATION: '#a855f7',
  DECISION: '#22d3a0',
  ACTION_ITEM: '#4f8ef7',
  COMPETITOR: '#f97316',
  COMMITMENT: '#22d3a0',
  RISK: '#ef4444',
  PURCHASE_INTENT: '#22d3a0',
};

export const PURCHASE_INTENT_LABELS: Record<string, string> = {
  very_high: 'Very High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

export const SENTIMENT_LABELS: Record<string, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  mixed: 'Mixed',
};
