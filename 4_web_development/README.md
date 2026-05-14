# Web Development Resources

Templates and starter kits for building custom web solutions for educational contexts.

## What's Inside

- **react-dashboards/** - React component library and dashboard templates
- **backend-api/** - Node.js and Python API templates with common ed-tech patterns
- **database-schemas/** - SQL schema examples for educational data models

## Why Build Custom?

- **Tailored to your needs** - Generic tools don't always fit your workflows
- **Integration** - Connect your existing systems (SIS, LMS, Classroom, etc.)
- **Ownership** - You control the data and the feature roadmap
- **Cost scaling** - Expensive tools are per-seat; custom solutions often have lower long-term cost

## Architecture Overview

```
┌─────────────────┐
│   Frontend      │  React Dashboard / Web App
│  (React)        │  - Visualizations
└────────┬────────┘  - Forms & input
         │           - Real-time updates
         │
    (REST API)
         │
┌────────▼────────┐
│   Backend       │  Node.js or Python API
│   (Express or   │  - Authentication
│    Flask)       │  - Data processing
└────────┬────────┘  - External integrations
         │
    (SQL/NoSQL)
         │
┌────────▼────────┐
│   Database      │  PostgreSQL, MySQL, or Cloud Firestore
│   (Schema       │  - Student data
│    provided)    │  - Assessment results
└─────────────────┘  - Usage logs
```

## Getting Started

### Quick Path (React Dashboard Only)

1. Navigate to `react-dashboards/`
2. Run `npm install` and `npm start`
3. Customize components in `src/` for your data

### Full Stack (Frontend + Backend + Database)

1. Set up database using schema from `database-schemas/`
2. Deploy backend API from `backend-api/` (choose Node or Python)
3. Build frontend using `react-dashboards/`
4. Connect frontend to your backend API endpoint

### Minimal Path (Backend Only)

Build an API to expose your data. Frontend can be a simple spreadsheet, dashboard tool, or custom page.

## Integration Patterns

### Google Classroom Integration

```javascript
// Example: Fetch class roster
const classroom = google.classroom('v1');
const courses = await classroom.courses.list();
```

### LMS Integration

Most LMS systems (Canvas, Blackboard, Schoology) offer REST APIs. See `backend-api/` for examples.

### Database Connection

Use the schema in `database-schemas/` and connect from your backend:

```javascript
// Node.js example
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const students = await pool.query('SELECT * FROM students WHERE class_id = $1', [classId]);
```

## Deployment Options

- **Heroku** - Easy, good for small projects (free tier ending)
- **Google Cloud** - Integrates well with Google Workspace
- **AWS** - Scalable, but more complex setup
- **DigitalOcean** - Simple and affordable
- **Vercel** - Great for React frontends

## Security Checklist

Before deploying:

- [ ] Authentication enabled (don't expose data publicly)
- [ ] Input validation on all forms
- [ ] HTTPS/SSL enabled
- [ ] API keys stored in environment variables
- [ ] Database credentials never hardcoded
- [ ] Rate limiting on API endpoints
- [ ] Regular backups configured

## Next Steps

1. **Define your MVP** - What's the minimum useful product?
2. **Choose your stack** - Node or Python? React or simpler HTML?
3. **Set up database** - Use provided schema or customize
4. **Build backend** - Get your data accessible via API
5. **Build frontend** - Create the user interface
6. **Test thoroughly** - Especially with real data
7. **Plan deployment** - Choose hosting, set up monitoring

---

**Tip:** Start simple. A spreadsheet + backend API can be deployed in a day. Fancy UI takes longer.

**Questions?** Check the README files in each subdirectory for more specific guidance.
