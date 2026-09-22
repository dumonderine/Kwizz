#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
user_problem_statement: "Kwizz — QCM app. New: Méthode des J (spaced reminders per chapter, reusable J series, calendar tab month/week, local notifications at chosen hour), Ancrage on/off + size setting, custom QCM count (max 100), generation text change."

backend:
  - task: "J schedules / events / presets API (/api/j/*), folder j_enabled/j_offsets, profile reminder_hour/anchor_enabled/anchor_size, generate auto-creates schedule, anchor uses anchor_size, generate clamps to 100"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Implemented, smoke-tested with curl. Needs full test."

frontend:
  - task: "Calendrier tab (month/week), J card + JScheduleModal in folder screen, J section in FolderFormModal, Profil settings (Ancrage toggle/size, reminder hour, J presets), custom QCM count in generate modal"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/calendar.tsx, /app/frontend/app/folder/[id].tsx, /app/frontend/src/components/j-schedule-modal.tsx, /app/frontend/src/components/j-series-picker.tsx, /app/frontend/app/(tabs)/profile.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Implemented; calendar screenshot OK on web."

metadata:
  created_by: "main_agent"
  version: "2.0"
  test_sequence: 2

test_plan:
  current_focus:
    - "J schedules API"
    - "Calendar tab UI"
    - "Profile settings"
  stuck_tasks: []
  test_all: false

agent_communication:
  - agent: "main"
    message: "Test account tester@kwizz.fr / secret123 (onboarded). Do NOT run /quizzes/generate more than once (Gemini cost); user reported a generation error earlier caused by backend auto-reload during my edits — please verify one generation succeeds end-to-end (use existing folder with text source or add a short text source)."
  - agent: "main"
    message: "UPDATE: generation is now a background job: POST /api/quizzes/generate returns {id,status:'pending'}; poll GET /api/quizzes/jobs/{id} until status done (quiz_id) or error. GET /api/quizzes/jobs?folder_id= lists active jobs. Model gemini-3.5-flash, batches of 10 in parallel. Verified 30 QCM in ~35s via curl. Frontend: folder screen polls job, shows progress row, 'Continuer en arrière-plan' button, custom count input (gen-count-custom). Please test: one generation E2E from the UI (10 questions) on folder 8e251e6b-0be7-43ce-881b-aa68b032cb8f (has a text source), the calendar tab, J modal in folder screen, folder create with J switch, profile settings (anchor toggle/size, reminder hour, presets)."
