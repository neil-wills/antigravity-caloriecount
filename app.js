/* ==========================================================================
   AuraCal / Lizzy's Plate - Core Application Script
   Includes State Store, Mifflin-St Jeor calculations, SVG Graph, PWA setup,
   and client-side Gemini Multimodal API connection.
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. Food Density & Nutrient Database (for Manual Inputs)
// --------------------------------------------------------------------------
const FOOD_DATABASE = {
  "apple": { density: 52, protein: 0.3 },
  "banana": { density: 89, protein: 1.1 },
  "avocado": { density: 160, protein: 2.0 },
  "chicken breast": { density: 165, protein: 31.0 },
  "salmon": { density: 208, protein: 20.0 },
  "greek yogurt": { density: 59, protein: 10.0 },
  "blueberries": { density: 57, protein: 0.7 },
  "oatmeal": { density: 389, protein: 16.9 },
  "egg": { density: 155, protein: 13.0 },
  "white rice": { density: 130, protein: 2.7 },
  "almonds": { density: 579, protein: 21.0 },
  "steak": { density: 271, protein: 25.0 },
  "broccoli": { density: 34, protein: 2.8 },
  "sweet potato": { density: 86, protein: 1.6 },
  "milk": { density: 42, protein: 3.4 },
  "bread": { density: 265, protein: 9.0 }
};

// Helper: Get density & protein per 100g
function lookupFood(name) {
  const cleanName = name.toLowerCase().trim();
  for (const [key, val] of Object.entries(FOOD_DATABASE)) {
    if (cleanName.includes(key)) {
      return val;
    }
  }
  return { density: 150, protein: 5.0 }; // Default fallback values
}

// --------------------------------------------------------------------------
// 2. Global State Store & Persistence
// --------------------------------------------------------------------------
const DEFAULT_MEAL_RANGES = {
  breakfastStart: "06:00",
  breakfastEnd: "10:00",
  lunchStart: "11:30",
  lunchEnd: "14:30",
  dinnerStart: "18:00",
  dinnerEnd: "21:00"
};

let state = {
  profile: null, // { name, age, weight, height, gender, activity, goal, targetCalories, targetProtein, apiKey, mealRanges, showHydration, showExercise }
  meals: {},     // Date key YYYY-MM-DD -> { breakfast: [], lunch: [], dinner: [], snacks: [] }
  water: {},     // Date key YYYY-MM-DD -> integer (glasses, max 8)
  exercise: {},  // Date key YYYY-MM-DD -> [{ name, duration, caloriesBurned }]
  currentDate: getTodayDateString(),
  composerMealType: 'breakfast',
  composerItems: []
};

// Utility to get YYYY-MM-DD in local time
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Load State from LocalStorage
function loadState() {
  const savedProfile = localStorage.getItem('auracal_profile');
  const savedMeals = localStorage.getItem('auracal_meals');
  const savedWater = localStorage.getItem('auracal_water');
  const savedExercise = localStorage.getItem('auracal_exercise');

  if (savedProfile) {
    state.profile = JSON.parse(savedProfile);
    if (state.profile && !state.profile.mealRanges) {
      state.profile.mealRanges = { ...DEFAULT_MEAL_RANGES };
    }
    if (savedMeals) state.meals = JSON.parse(savedMeals);
    if (savedWater) state.water = JSON.parse(savedWater);
    if (savedExercise) state.exercise = JSON.parse(savedExercise);
    return true;
  }
  return false;
}

// Save State to LocalStorage
function saveState() {
  if (state.profile) {
    localStorage.setItem('auracal_profile', JSON.stringify(state.profile));
    localStorage.setItem('auracal_meals', JSON.stringify(state.meals));
    localStorage.setItem('auracal_water', JSON.stringify(state.water));
    localStorage.setItem('auracal_exercise', JSON.stringify(state.exercise));
  }
}

// Auto-detect meal type based on local time and user ranges
function detectCurrentMealType() {
  const d = new Date();
  const currentHour = d.getHours();
  const currentMin = d.getMinutes();
  
  // Format current local time as HH:MM (matches 24h clock input syntax)
  const currentHM = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
  
  const ranges = (state.profile && state.profile.mealRanges) ? state.profile.mealRanges : DEFAULT_MEAL_RANGES;

  function timeInWindow(timeStr, startStr, endStr) {
    // String comparisons of HH:MM work perfectly for zero-padded values
    return timeStr >= startStr && timeStr <= endStr;
  }

  if (timeInWindow(currentHM, ranges.breakfastStart, ranges.breakfastEnd)) {
    return 'breakfast';
  } else if (timeInWindow(currentHM, ranges.lunchStart, ranges.lunchEnd)) {
    return 'lunch';
  } else if (timeInWindow(currentHM, ranges.dinnerStart, ranges.dinnerEnd)) {
    return 'dinner';
  } else {
    return 'snacks';
  }
}

// Utility to get graphic icon representation of a meal period
function getMealPeriodIcon(mealType) {
  const icons = {
    breakfast: '🌅',
    lunch: '☀️',
    dinner: '🌙',
    snacks: '🍎'
  };
  return icons[mealType.toLowerCase()] || '🍽️';
}

// Scan Quota Limits Management (Limits family users from exhausting shared Gemini API key)
const MAX_DAILY_SCANS = 20;

function getDailyScanCount() {
  const todayStr = getTodayDateString();
  const savedDate = localStorage.getItem('auracal_scan_date');
  const savedCount = localStorage.getItem('auracal_scan_count');

  if (savedDate !== todayStr) {
    localStorage.setItem('auracal_scan_date', todayStr);
    localStorage.setItem('auracal_scan_count', '0');
    return 0;
  }
  return parseInt(savedCount || '0', 10);
}

function incrementDailyScanCounter() {
  const current = getDailyScanCount();
  localStorage.setItem('auracal_scan_count', String(current + 1));
  updateSettingsScanUsage();
}

function updateSettingsScanUsage() {
  const usageText = document.getElementById('api-usage-status');
  if (usageText) {
    const hasKey = state.profile && state.profile.apiKey && state.profile.apiKey.trim() !== '';
    if (hasKey) {
      usageText.classList.remove('hidden');
      const current = getDailyScanCount();
      usageText.textContent = `Daily AI Usage: ${current} / ${MAX_DAILY_SCANS} scans completed today`;
    } else {
      usageText.classList.add('hidden');
    }
  }
}

// Applies conditional visibility on trackers based on user settings
function applyTrackerVisibility() {
  const showHydration = !state.profile || state.profile.showHydration !== false;
  const showExercise = !state.profile || state.profile.showExercise !== false;

  // Toggle Hydration Visibility
  const hydrationCard = document.getElementById('card-dashboard-hydration');
  if (hydrationCard) {
    if (showHydration) hydrationCard.classList.remove('hidden');
    else hydrationCard.classList.add('hidden');
  }

  // Toggle Exercise Visibility
  const exerciseDashboardCard = document.getElementById('card-dashboard-exercise');
  if (exerciseDashboardCard) {
    if (showExercise) exerciseDashboardCard.classList.remove('hidden');
    else exerciseDashboardCard.classList.add('hidden');
  }
  const exerciseLogCard = document.getElementById('card-log-exercise');
  if (exerciseLogCard) {
    if (showExercise) exerciseLogCard.classList.remove('hidden');
    else exerciseLogCard.classList.add('hidden');
  }
}

// Recalculate Mifflin-St Jeor Targets
// Men: BMR = 10 * weight (kg) + 6.25 * height (cm) - 5 * age (y) + 5
// Women: BMR = 10 * weight (kg) + 6.25 * height (cm) - 5 * age (y) - 161
function calculateNutrientTargets(profile) {
  const weight = parseFloat(profile.weight);
  const height = parseFloat(profile.height);
  const age = parseInt(profile.age);
  const gender = profile.gender;
  const activity = parseFloat(profile.activity);
  const goal = profile.goal;

  let bmr = 0;
  if (gender === 'male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  const tdee = bmr * activity;
  let targetCalories = Math.round(tdee);

  if (goal === 'lose') {
    targetCalories = Math.round(tdee - 450);
    // Lower threshold safety rules
    const minCals = (gender === 'male') ? 1500 : 1200;
    if (targetCalories < minCals) targetCalories = minCals;
  } else if (goal === 'gain') {
    targetCalories = Math.round(tdee + 250);
  }

  // Elevated protein guidelines for individuals 50+ (approx 1.5g per kg bodyweight)
  // to protect against sarcopenia (muscle loss) and promote bone density.
  let targetProtein = Math.round(weight * 1.5);
  if (targetProtein < 60) targetProtein = 60; // Lower safety baseline

  return { targetCalories, targetProtein };
}

// --------------------------------------------------------------------------
// 3. UI State Management and Router
// --------------------------------------------------------------------------
function switchTab(targetTab) {
  applyTrackerVisibility();
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.app-panel');

  // Update Tab Navigation Active State
  tabs.forEach(t => {
    if (t.getAttribute('data-tab') === targetTab) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  // Show Selected Panel, Hide Others
  panels.forEach(panel => {
    if (panel.id === `panel-${targetTab}`) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  });

  // Special Trigger on panel load
  if (targetTab === 'dashboard') {
    renderDashboard();
  } else if (targetTab === 'log') {
    renderMealsLog();
  } else if (targetTab === 'history') {
    renderHistoryChart();
  } else if (targetTab === 'settings') {
    loadSettingsInputs();
  }
}

function initRouter() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

// --------------------------------------------------------------------------
// 4. Wizard Setup & Onboarding Flow
// --------------------------------------------------------------------------
function initOnboarding() {
  const onboardingScreen = document.getElementById('screen-onboarding');
  const mainScreen = document.getElementById('screen-main');
  const onboardingForm = document.getElementById('form-onboarding');

  const next1 = document.getElementById('btn-onboard-next-1');
  const prev2 = document.getElementById('btn-onboard-prev-2');
  const step1 = document.querySelector('.form-step[data-step="1"]');
  const step2 = document.querySelector('.form-step[data-step="2"]');
  
  const unitsSelect = document.getElementById('input-units');
  const imperialInputs = document.getElementById('onboard-imperial-inputs');
  const metricInputs = document.getElementById('onboard-metric-inputs');

  unitsSelect.addEventListener('change', () => {
    if (unitsSelect.value === 'imperial') {
      imperialInputs.classList.remove('hidden');
      metricInputs.classList.add('hidden');
    } else {
      imperialInputs.classList.add('hidden');
      metricInputs.classList.remove('hidden');
    }
  });

  // Handle Cancel onboarding buttons
  document.querySelectorAll('.btn-cancel-onboard').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Discard onboarding and start over?')) {
        localStorage.removeItem('auracal_profile');
        localStorage.removeItem('auracal_meals');
        localStorage.removeItem('auracal_water');
        window.location.reload();
      }
    });
  });

  next1.addEventListener('click', () => {
    const name = document.getElementById('input-display-name').value.trim();
    const age = document.getElementById('input-age').value;
    const units = unitsSelect.value;

    let isValid = false;
    if (units === 'imperial') {
      const wLbs = document.getElementById('input-weight-lbs').value;
      const hFt = document.getElementById('input-height-ft').value;
      const hIn = document.getElementById('input-height-in').value;
      isValid = (name && age && wLbs && hFt && hIn);
    } else {
      const wKg = document.getElementById('input-weight-kg').value;
      const hCm = document.getElementById('input-height-cm').value;
      isValid = (name && age && wKg && hCm);
    }

    if (isValid) {
      step1.classList.remove('active');
      step2.classList.add('active');
    } else {
      alert('Please fill out all inputs before moving to the next step.');
    }
  });

  prev2.addEventListener('click', () => {
    step2.classList.remove('active');
    step1.classList.add('active');
  });

  onboardingForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('input-display-name').value.trim() || "Elizabeth";
    const age = parseInt(document.getElementById('input-age').value);
    const gender = document.querySelector('input[name="gender"]:checked').value;
    const activity = parseFloat(document.getElementById('input-activity').value);
    const goal = document.getElementById('input-goal').value;
    const units = unitsSelect.value;

    let weightKg = 0;
    let heightCm = 0;
    let rawWeight = 0;
    let rawHeightFt = 0;
    let rawHeightIn = 0;
    let rawHeightCm = 0;

    if (units === 'imperial') {
      rawWeight = parseFloat(document.getElementById('input-weight-lbs').value);
      rawHeightFt = parseInt(document.getElementById('input-height-ft').value);
      rawHeightIn = parseInt(document.getElementById('input-height-in').value);
      
      weightKg = rawWeight * 0.45359237;
      heightCm = (rawHeightFt * 12 + rawHeightIn) * 2.54;
    } else {
      rawWeight = parseFloat(document.getElementById('input-weight-kg').value);
      rawHeightCm = parseFloat(document.getElementById('input-height-cm').value);
      
      weightKg = rawWeight;
      heightCm = rawHeightCm;
    }

    const avatar = document.getElementById('input-avatar-select').value || '🥑';

    const rawProfile = { 
      name, age, gender, units, 
      weight: weightKg, height: heightCm, 
      rawWeight, rawHeightFt, rawHeightIn, rawHeightCm,
      activity, goal, apiKey: '',
      tipsDismissed: false,
      avatar,
      mealRanges: { ...DEFAULT_MEAL_RANGES },
      showHydration: true,
      showExercise: true
    };

    const { targetCalories, targetProtein } = calculateNutrientTargets(rawProfile);

    state.profile = { ...rawProfile, targetCalories, targetProtein };
    
    // Seed blank structures for today
    const todayStr = getTodayDateString();
    state.meals[todayStr] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    state.water[todayStr] = 0;

    saveState();

    onboardingScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');

    updateDisplayTitle();
    
    // Force switch tab view to Daily Meals Log tab on first setup completion
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.nav-tab[data-tab="log"]').classList.add('active');
    document.querySelectorAll('.app-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('panel-log').classList.remove('hidden');

    renderMealsLog();
    renderDashboard();
  });
}

function updateDisplayTitle() {
  const displayTitle = document.getElementById('app-title-display');
  const avatarCircle = document.getElementById('header-avatar-circle');
  const welcomeAvatar = document.getElementById('welcome-tip-avatar');
  const welcomeUsername = document.getElementById('welcome-tip-username');
  const settingsAvatar = document.getElementById('settings-avatar-icon');
  const settingsName = document.getElementById('settings-name-display');

  if (state.profile) {
    const name = state.profile.name || 'Elizabeth';
    const avatar = state.profile.avatar || '🥑';

    if (displayTitle) {
      displayTitle.textContent = `${name}'s Plate`;
      document.title = `${name}'s Plate - Calorie Tracker`;
    }
    if (avatarCircle) {
      avatarCircle.textContent = avatar;
    }
    if (welcomeAvatar) {
      welcomeAvatar.textContent = avatar;
    }
    if (welcomeUsername) {
      welcomeUsername.textContent = name;
    }
    if (settingsAvatar) {
      settingsAvatar.textContent = avatar;
    }
    if (settingsName) {
      settingsName.textContent = name;
    }
  }
}

// --------------------------------------------------------------------------
// 5. Rendering - Dashboard View
// --------------------------------------------------------------------------
function renderDashboard() {
  if (!state.profile) return;

  // Toggle Welcome Tips Card
  const tipsCard = document.getElementById('dashboard-welcome-tips');
  if (state.profile.tipsDismissed) {
    tipsCard.classList.add('hidden');
  } else {
    tipsCard.classList.remove('hidden');
    document.getElementById('welcome-tip-username').textContent = state.profile.name || 'Elizabeth';
  }

  // Update Avo-Buddy speech bubble context
  updateAvoSpeech();

  const dateKey = state.currentDate;
  
  // Initialize standard structures if date is missing
  if (!state.meals[dateKey]) {
    state.meals[dateKey] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
  }
  if (state.water[dateKey] === undefined) {
    state.water[dateKey] = 0;
  }

  const todayMeals = state.meals[dateKey];
  const targetCals = state.profile.targetCalories;
  const targetProt = state.profile.targetProtein;

  // 1. Calculate calorie math sums
  let eatenCalories = 0;
  let eatenProtein = 0;

  for (const period of ['breakfast', 'lunch', 'dinner', 'snacks']) {
    if (todayMeals[period]) {
      todayMeals[period].forEach(item => {
        eatenCalories += parseFloat(item.calories || 0);
        eatenProtein += parseFloat(item.protein || 0);
      });
    }
  }

  eatenCalories = Math.round(eatenCalories);
  eatenProtein = Math.round(eatenProtein);
  const remainingCalories = targetCals - eatenCalories;

  // 2. Update text panels
  document.getElementById('display-target-calories').textContent = targetCals;
  document.getElementById('display-eaten-calories').textContent = eatenCalories;
  document.getElementById('display-math-remaining').textContent = remainingCalories;
  
  const displayLeft = document.getElementById('display-calories-left');
  displayLeft.textContent = Math.abs(remainingCalories);
  
  const circleLabel = document.querySelector('.calories-left-label');
  if (remainingCalories >= 0) {
    circleLabel.textContent = 'kcal left';
    displayLeft.style.color = '';
  } else {
    circleLabel.textContent = 'kcal over';
    displayLeft.style.color = 'var(--accent-danger)';
  }

  // 3. Calorie SVG Ring Animation
  const circleFill = document.getElementById('circle-progress');
  const circumference = 2 * Math.PI * 50; // Radius = 50, circumference ~314.16
  const progressRatio = Math.min(eatenCalories / targetCals, 1.0);
  const offset = circumference - (progressRatio * circumference);
  circleFill.style.strokeDashoffset = offset;

  // Dynamic progress ring colors depending on percentage
  if (progressRatio >= 1.0 && remainingCalories < -100) {
    circleFill.style.stroke = 'var(--accent-danger)';
  } else if (progressRatio >= 0.85) {
    circleFill.style.stroke = 'var(--accent-teal)'; // Approaching target is positive
  } else {
    circleFill.style.stroke = 'var(--accent-orange)';
  }

  // 4. Update Protein progress bar
  document.getElementById('display-protein-text').textContent = `${eatenProtein}g / ${targetProt}g`;
  const proteinPercent = Math.min((eatenProtein / targetProt) * 100, 100);
  document.getElementById('bar-protein-fill').style.width = `${proteinPercent}%`;

  // 5. Render water glass hydration tracker
  renderWaterGlasses();

  // Update dashboard exercise card values
  if (!state.exercise[dateKey]) {
    state.exercise[dateKey] = [];
  }
  const workouts = state.exercise[dateKey];
  let totalKcalBurned = 0;
  workouts.forEach(w => {
    totalKcalBurned += parseInt(w.caloriesBurned || 0, 10);
  });
  
  const displayVal = document.getElementById('display-exercise-val');
  if (displayVal) {
    displayVal.textContent = `${totalKcalBurned} kcal burned`;
  }
  
  const displaySummary = document.getElementById('display-exercise-summary');
  if (displaySummary) {
    if (workouts.length === 0) {
      displaySummary.textContent = 'No workouts logged';
    } else {
      const lastWorkout = workouts[workouts.length - 1];
      displaySummary.textContent = `${lastWorkout.name} (${lastWorkout.duration}m)`;
    }
  }

  // 6. Update Period Header text
  const isToday = (dateKey === getTodayDateString());
  document.getElementById('dashboard-meal-period').textContent = isToday ? 'Today' : dateKey;
}

function renderWaterGlasses() {
  const dateKey = state.currentDate;
  const glassCount = state.water[dateKey] || 0;
  const container = document.getElementById('water-glasses-container');
  container.innerHTML = '';

  for (let i = 1; i <= 8; i++) {
    const btn = document.createElement('button');
    btn.className = `glass-btn ${i <= glassCount ? 'active' : ''}`;
    btn.innerHTML = '🥛';
    btn.setAttribute('aria-label', `Water glass ${i}`);
    
    btn.addEventListener('click', () => {
      // Toggle glass count logic
      if (state.water[dateKey] === i) {
        state.water[dateKey] = i - 1;
      } else {
        state.water[dateKey] = i;
      }
      saveState();
      renderWaterGlasses();
      document.getElementById('display-water-val').textContent = `${state.water[dateKey]} / 8 glasses`;
    });
    container.appendChild(btn);
  }

  document.getElementById('display-water-val').textContent = `${glassCount} / 8 glasses`;
}

function renderExerciseLog() {
  const dateKey = state.currentDate;
  
  if (!state.exercise[dateKey]) {
    state.exercise[dateKey] = [];
  }
  
  const workouts = state.exercise[dateKey];
  const listDetail = document.getElementById('exercise-items-list-detail');
  
  let totalKcal = 0;
  let totalTime = 0;
  
  workouts.forEach(w => {
    totalKcal += parseInt(w.caloriesBurned || 0, 10);
    totalTime += parseInt(w.duration || 0, 10);
  });
  
  // Update log totals
  const totalKcalDisplay = document.getElementById('log-exercise-total-kcal');
  const totalTimeDisplay = document.getElementById('log-exercise-total-time');
  if (totalKcalDisplay) totalKcalDisplay.textContent = `${totalKcal} kcal`;
  if (totalTimeDisplay) totalTimeDisplay.textContent = `${totalTime} mins`;
  
  if (!listDetail) return;
  listDetail.innerHTML = '';
  
  if (workouts.length === 0) {
    listDetail.innerHTML = `<p class="empty-list-placeholder">No exercise logged yet.</p>`;
  } else {
    workouts.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'log-item-row';
      row.style.borderBottom = '1px solid var(--border-color)';
      row.style.padding = '6px 0';
      row.innerHTML = `
        <div class="log-item-info">
          <span class="log-item-title" style="font-weight: 700;">${item.name}</span>
          <span class="log-item-subtitle" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500;">${item.duration} mins | ${item.caloriesBurned} kcal burned</span>
        </div>
        <div class="log-item-values">
          <button class="btn-item-action delete-btn exercise-log-del" data-index="${index}" aria-label="Delete workout">
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path fill="currentColor" d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"/></svg>
          </button>
        </div>
      `;
      listDetail.appendChild(row);
    });
    
    // Bind deletes
    listDetail.querySelectorAll('.exercise-log-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        state.exercise[dateKey].splice(idx, 1);
        saveState();
        renderExerciseLog();
        renderDashboard();
      });
    });
  }
}

// --------------------------------------------------------------------------
// 6. Rendering - Meals Log Panel View
// --------------------------------------------------------------------------
function renderMealsLog() {
  const dateKey = state.currentDate;
  const listContainer = document.getElementById('meals-log-list');
  listContainer.innerHTML = '';

  const dayMeals = state.meals[dateKey] || { breakfast: [], lunch: [], dinner: [], snacks: [] };
  
  const mealSVGs = {
    breakfast: `<svg class="meal-svg" viewBox="0 0 24 24" style="width: 22px; height: 22px; margin-right: 6px;"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 9h10v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15 11h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 19h18"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M7 6c0-1.5 1-2 1-2M11 6c0-1.5 1-2 1-2M15 6c0-1.5 1-2 1-2"/></svg>`,
    lunch: `<svg class="meal-svg" viewBox="0 0 24 24" style="width: 22px; height: 22px; margin-right: 6px;"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 8v8"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 8v5M14 8v3M18 8v3M14 11h8"/></svg>`,
    dinner: `<svg class="meal-svg" viewBox="0 0 24 24" style="width: 22px; height: 22px; margin-right: 6px;"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 19h20"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 17a8 8 0 0 1 16 0"/><circle cx="12" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M12 4c.5-1 .5-1.5.5-2"/></svg>`,
    snacks: `<svg class="meal-svg" viewBox="0 0 24 24" style="width: 22px; height: 22px; margin-right: 6px;"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 17c-2-1-4 .5-6-1.5c-2.5-2.5-1.5-6.5 1-7.5c2.5-1 4 1 5 1s2.5-2 5-1c2.5 1 3.5 5 1 7.5c-2 2-4 .5-6 1.5Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 8c0-2 1-3 2-3"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M14 5c1 .5 2 1 2 2s-1 1-2 0s-1-2 0-2"/></svg>`
  };

  const mealPeriods = [
    { id: 'breakfast', name: 'Breakfast', svg: mealSVGs.breakfast },
    { id: 'lunch', name: 'Lunch', svg: mealSVGs.lunch },
    { id: 'dinner', name: 'Dinner', svg: mealSVGs.dinner },
    { id: 'snacks', name: 'Snacks', svg: mealSVGs.snacks }
  ];

  let totalItemsCount = 0;

  mealPeriods.forEach(period => {
    const items = dayMeals[period.id] || [];
    totalItemsCount += items.length;

    // Sum totals for this group
    let periodCalories = 0;
    let periodProtein = 0;
    items.forEach(it => {
      periodCalories += parseFloat(it.calories || 0);
      periodProtein += parseFloat(it.protein || 0);
    });
    periodCalories = Math.round(periodCalories);
    periodProtein = Math.round(periodProtein);

    // Create group element card
    const card = document.createElement('div');
    card.className = `meal-group-card ${items.length > 0 ? 'expanded' : ''}`;
    card.id = `meal-group-${period.id}`;

    // Header element
    const header = document.createElement('div');
    header.className = 'meal-group-header';
    header.innerHTML = `
      <div class="meal-title-block">
        <span class="meal-emoji" style="display: flex; align-items: center;">${period.svg}</span>
        <span class="meal-name">${period.name}</span>
      </div>
      <div class="meal-group-totals">
        <span class="meal-total-kcal">${periodCalories} kcal</span>
        <span class="meal-total-prot">${periodProtein}g protein</span>
        <svg viewBox="0 0 24 24" class="chevron-icon"><path fill="currentColor" d="M7.41 8.58L12 13.17l4.59-4.59L18 10l-6 6l-6-6l1.41-1.42Z"/></svg>
      </div>
    `;

    // Items list detail drawer
    const listDiv = document.createElement('div');
    listDiv.className = `meal-items-detail-list ${items.length > 0 ? '' : 'hidden'}`;

    if (items.length === 0) {
      listDiv.innerHTML = `<p class="empty-list-placeholder">No items logged yet.</p>`;
    } else {
      items.forEach((item, index) => {
        const itemRow = document.createElement('div');
        itemRow.className = 'log-item-row';
        const ingredientsText = (item.ingredients && Array.isArray(item.ingredients) && item.ingredients.length > 0)
          ? `<span class="log-item-ingredients" style="font-size: 0.72rem; color: var(--accent-teal); font-style: italic; display: block; margin-top: 2px;">🔍 Ingredients: ${item.ingredients.join(', ')}</span>`
          : '';

        itemRow.innerHTML = `
          <div class="log-item-info">
            <span class="log-item-title">${item.name}</span>
            <span class="log-item-subtitle">${item.weightGrams}g ${item.protein ? `| ${item.protein}g protein` : ''}</span>
            ${ingredientsText}
          </div>
          <div class="log-item-values">
            <span class="log-item-calories">${Math.round(item.calories)} kcal</span>
            <div class="log-item-actions">
              <button class="btn-item-action edit-btn" data-meal="${period.id}" data-index="${index}" aria-label="Edit food item">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83l3.75 3.75l1.83-1.83z"/></svg>
              </button>
              <button class="btn-item-action delete-btn" data-meal="${period.id}" data-index="${index}" aria-label="Delete food item">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>
        `;
        listDiv.appendChild(itemRow);
      });
    }

    // Toggle expand/collapse drawer event
    header.addEventListener('click', () => {
      card.classList.toggle('expanded');
      listDiv.classList.toggle('hidden');
    });

    card.appendChild(header);
    card.appendChild(listDiv);
    listContainer.appendChild(card);
  });

  // Render list fallback if no meals at all
  if (totalItemsCount === 0) {
    listContainer.innerHTML = `
      <div class="no-meals-log">
        <p style="font-size: 1.8rem; margin-bottom: 8px;">🍽️</p>
        <p>No food logged for today yet.</p>
        <button id="btn-empty-add" class="btn btn-secondary-outline" style="margin-top: 15px; width: auto; display: inline-block;">Log Your First Meal</button>
      </div>
    `;
    document.getElementById('btn-empty-add').addEventListener('click', () => {
      openComposer('breakfast');
    });
  }

  // Toggle Clear All Today Button
  const clearBtn = document.getElementById('btn-clear-day-logs');
  if (totalItemsCount > 0) {
    clearBtn.classList.remove('hidden');
  } else {
    clearBtn.classList.add('hidden');
  }

  // Register edit & delete event listeners
  listContainer.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const meal = btn.getAttribute('data-meal');
      const idx = parseInt(btn.getAttribute('data-index'));
      openEditModal(meal, idx);
    });
  });

  listContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const meal = btn.getAttribute('data-meal');
      const idx = parseInt(btn.getAttribute('data-index'));
      if (confirm('Delete this food item?')) {
        deleteFoodItem(meal, idx);
      }
    });
  });

  renderExerciseLog();
}

// --------------------------------------------------------------------------
// 6b. Modals: Exercise Logger Logic
// --------------------------------------------------------------------------
function openExerciseModal() {
  document.getElementById('exercise-input-name').value = '';
  document.getElementById('exercise-input-duration').value = '';
  document.getElementById('exercise-input-calories').value = '';
  document.getElementById('modal-exercise').classList.remove('hidden');
}

function closeExerciseModal() {
  document.getElementById('modal-exercise').classList.add('hidden');
}

function handleSaveExercise() {
  const name = document.getElementById('exercise-input-name').value.trim();
  const duration = parseInt(document.getElementById('exercise-input-duration').value, 10);
  const caloriesBurned = parseInt(document.getElementById('exercise-input-calories').value, 10);

  if (!name || isNaN(duration) || isNaN(caloriesBurned)) {
    alert('Please enter valid workout details.');
    return;
  }

  const dateKey = state.currentDate;
  if (!state.exercise[dateKey]) {
    state.exercise[dateKey] = [];
  }

  state.exercise[dateKey].push({ name, duration, caloriesBurned });
  saveState();
  closeExerciseModal();
  renderExerciseLog();
  renderDashboard();
}

// --------------------------------------------------------------------------
// 7. Modals: Edit Item Logic
// --------------------------------------------------------------------------
function openEditModal(mealType, itemIndex) {
  const dateKey = state.currentDate;
  const item = state.meals[dateKey][mealType][itemIndex];

  document.getElementById('edit-meal-type').value = mealType;
  document.getElementById('edit-item-index').value = itemIndex;
  document.getElementById('edit-meal-date').value = dateKey;

  document.getElementById('edit-food-name').value = item.name;
  document.getElementById('edit-food-weight').value = item.weightGrams;
  document.getElementById('edit-food-calories').value = Math.round(item.calories);
  document.getElementById('edit-food-protein').value = item.protein || 0;

  document.getElementById('modal-edit-item').classList.remove('hidden');
}

function closeEditModal() {
  document.getElementById('modal-edit-item').classList.add('hidden');
}

function saveEditItem(e) {
  e.preventDefault();
  const mealType = document.getElementById('edit-meal-type').value;
  const index = parseInt(document.getElementById('edit-item-index').value);
  const dateKey = document.getElementById('edit-meal-date').value;

  const item = state.meals[dateKey][mealType][index];
  item.name = document.getElementById('edit-food-name').value.trim();
  item.weightGrams = parseFloat(document.getElementById('edit-food-weight').value);
  item.calories = parseFloat(document.getElementById('edit-food-calories').value);
  item.protein = parseFloat(document.getElementById('edit-food-protein').value);

  saveState();
  closeEditModal();
  renderMealsLog();
  renderDashboard();
}

function deleteFoodItem(mealType, index) {
  const dateKey = state.currentDate;
  state.meals[dateKey][mealType].splice(index, 1);
  saveState();
  renderMealsLog();
  renderDashboard();
}

// --------------------------------------------------------------------------
// 8. Modals: Meal Composer Logic
// --------------------------------------------------------------------------
function openComposer(mealType) {
  state.composerMealType = mealType;
  state.composerItems = [];
  
  document.getElementById('composer-meal-type').textContent = mealType.charAt(0).toUpperCase() + mealType.slice(1);
  const composerIcon = document.getElementById('composer-meal-icon');
  if (composerIcon) {
    composerIcon.textContent = getMealPeriodIcon(mealType);
  }
  
  const mealSelect = document.getElementById('composer-meal-select');
  if (mealSelect) {
    mealSelect.value = mealType;
  }
  
  // Clear Manual form inputs
  document.getElementById('manual-food-name').value = '';
  document.getElementById('manual-food-weight').value = '';
  document.getElementById('manual-food-density').value = '150';
  document.getElementById('calc-preview-calories').textContent = '0';
  document.getElementById('calc-preview-protein').textContent = '0.0';

  renderComposerItems();
  document.getElementById('modal-composer').classList.remove('hidden');
}

function closeComposer() {
  document.getElementById('modal-composer').classList.add('hidden');
}

function renderComposerItems() {
  const list = document.getElementById('composer-items-list');
  list.innerHTML = '';

  if (state.composerItems.length === 0) {
    list.innerHTML = `<p class="empty-list-placeholder">No items added to this meal yet. Use scanner or manual tools below.</p>`;
  } else {
    state.composerItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'log-item-row';
      row.style.borderBottom = '1px solid var(--border-color)';
      row.style.padding = '6px 0';
      const ingredientsText = (item.ingredients && Array.isArray(item.ingredients) && item.ingredients.length > 0)
        ? `<span class="log-item-ingredients" style="font-size: 0.72rem; color: var(--accent-teal); font-style: italic; display: block; margin-top: 2px;">🔍 Ingredients: ${item.ingredients.join(', ')}</span>`
        : '';

      row.innerHTML = `
        <div class="log-item-info">
          <span class="log-item-title">${item.name}</span>
          <span class="log-item-subtitle">${item.weightGrams}g</span>
          ${ingredientsText}
        </div>
        <div class="log-item-values">
          <span class="log-item-calories">${Math.round(item.calories)} kcal</span>
          <button class="btn-item-action delete-btn composer-item-del" data-index="${index}" aria-label="Remove item">
            <svg viewBox="0 0 24 24" style="width: 14px; height: 14px;"><path fill="currentColor" d="M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"/></svg>
          </button>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('.composer-item-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'));
        state.composerItems.splice(idx, 1);
        renderComposerItems();
      });
    });
  }

  // Recalculate totals
  let mealCals = 0;
  let mealProt = 0;
  state.composerItems.forEach(it => {
    mealCals += it.calories;
    mealProt += it.protein;
  });

  document.getElementById('composer-total-calories').textContent = Math.round(mealCals);
  document.getElementById('composer-total-protein').textContent = Math.round(mealProt);
}

// Live Calculations on manual input form
function updateManualPreview() {
  const name = document.getElementById('manual-food-name').value;
  const weight = parseFloat(document.getElementById('manual-food-weight').value) || 0;
  let density = parseFloat(document.getElementById('manual-food-density').value) || 0;

  // Auto Density check on input name change
  if (name && document.activeElement === document.getElementById('manual-food-name')) {
    const lookup = lookupFood(name);
    density = lookup.density;
    document.getElementById('manual-food-density').value = density;
  }

  const cals = weight * (density / 100);
  
  // Estimate protein
  const lookup = lookupFood(name);
  const prot = weight * (lookup.protein / 100);

  document.getElementById('calc-preview-calories').textContent = Math.round(cals);
  document.getElementById('calc-preview-protein').textContent = prot.toFixed(1);
}

function handleManualAdd() {
  const nameInput = document.getElementById('manual-food-name');
  const weightInput = document.getElementById('manual-food-weight');
  const densityInput = document.getElementById('manual-food-density');

  const name = nameInput.value.trim();
  const weight = parseFloat(weightInput.value);
  const density = parseFloat(densityInput.value);

  if (!name || isNaN(weight) || isNaN(density)) {
    alert('Please enter a valid food name, weight, and caloric density.');
    return;
  }

  const calories = weight * (density / 100);
  const lookup = lookupFood(name);
  const protein = parseFloat((weight * (lookup.protein / 100)).toFixed(1));

  // If the user enters a comma-separated list of items, extract them as ingredients list
  const parts = name.split(',').map(s => s.trim()).filter(Boolean);
  const ingredients = parts.length > 1 ? parts : [];

  state.composerItems.push({ 
    name, 
    weightGrams: weight, 
    calories, 
    protein,
    ingredients
  });

  // Clear inputs
  nameInput.value = '';
  weightInput.value = '';
  densityInput.value = '150';
  document.getElementById('calc-preview-calories').textContent = '0';
  document.getElementById('calc-preview-protein').textContent = '0.0';

  renderComposerItems();
}

function handleSaveMeal() {
  if (state.composerItems.length === 0) {
    alert('Please add at least one item before saving the meal.');
    return;
  }

  const dateKey = state.currentDate;
  const mealPeriod = state.composerMealType;

  if (!state.meals[dateKey]) {
    state.meals[dateKey] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
  }

  state.composerItems.forEach(item => {
    state.meals[dateKey][mealPeriod].push(item);
  });

  saveState();
  closeComposer();

  // If in logs tab, update lists; otherwise update dashboard
  const activeTab = document.querySelector('.nav-tab.active').getAttribute('data-tab');
  if (activeTab === 'log') {
    renderMealsLog();
  } else {
    renderDashboard();
  }
}

// --------------------------------------------------------------------------
// 9. Vision AI Scanner Modal & Multimodal Client
// --------------------------------------------------------------------------
let scannerMode = 'unified'; // 'unified' or mock overrides

function openScanner(mode) {
  // If the user has a real API Key saved, enforce the daily quota check!
  // (In mock demonstration mode, we let them use templates indefinitely without limits)
  const isMock = !state.profile || !state.profile.apiKey;
  if (!isMock && getDailyScanCount() >= MAX_DAILY_SCANS) {
    alert(`Daily AI Scan Limit Reached!\n\nTo protect shared developer API quota, scanning is capped at ${MAX_DAILY_SCANS} scans per day.\n\nYou can still enter your meals manually! 🥑`);
    return;
  }

  scannerMode = mode || 'unified';
  const title = document.getElementById('scanner-modal-title');
  title.textContent = 'AI Camera Scanner';

  // Set scanning active meal header context
  const activeMeal = state.composerMealType || 'breakfast';
  const scannerIcon = document.getElementById('scanner-active-meal-icon');
  const scannerName = document.getElementById('scanner-active-meal-name');
  if (scannerIcon) {
    scannerIcon.textContent = getMealPeriodIcon(activeMeal);
  }
  if (scannerName) {
    scannerName.textContent = activeMeal.charAt(0).toUpperCase() + activeMeal.slice(1);
  }

  // Toggle bounding target box display (hidden by default for general unified scanning)
  const scaleBox = document.getElementById('scale-target-box');
  if (scaleBox) {
    scaleBox.classList.add('hidden');
  }

  // Switch scanner state back to file selection
  setScannerState('select');
  document.getElementById('camera-file-input').value = ''; // Reset
  document.getElementById('modal-scanner').classList.remove('hidden');
}

function closeScanner() {
  document.getElementById('modal-scanner').classList.add('hidden');
}

function setScannerState(stateName) {
  document.getElementById('scanner-state-select').classList.add('hidden');
  document.getElementById('scanner-state-scanning').classList.add('hidden');
  document.getElementById('scanner-state-results').classList.add('hidden');
  document.getElementById('scanner-state-error').classList.add('hidden');
  document.getElementById('btn-scanner-add').classList.add('hidden');

  if (stateName === 'select') {
    document.getElementById('scanner-state-select').classList.remove('hidden');
  } else if (stateName === 'scanning') {
    document.getElementById('scanner-state-scanning').classList.remove('hidden');
  } else if (stateName === 'results') {
    document.getElementById('scanner-state-results').classList.remove('hidden');
    document.getElementById('btn-scanner-add').classList.remove('hidden');
  } else if (stateName === 'error') {
    document.getElementById('scanner-state-error').classList.remove('hidden');
  }
}

// Handler for Image Capture
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Render Image Preview
  const reader = new FileReader();
  reader.onload = function(event) {
    const dataUrl = event.target.result;
    document.getElementById('scanner-image-preview').src = dataUrl;
    
    // Set Scanning UI
    setScannerState('scanning');
    
    // Base64 extract (removing metadata headers)
    const base64Data = dataUrl.split(',')[1];
    const mimeType = file.type;

    processVisionAnalysis(base64Data, mimeType);
  };
  reader.readAsDataURL(file);
}

// Routing: Gemini API vs Mock Estimation
function processVisionAnalysis(base64Data, mimeType) {
  const apiKey = state.profile ? state.profile.apiKey : '';

  if (apiKey && apiKey.trim() !== '') {
    callGeminiVisionAPI(base64Data, mimeType, apiKey);
  } else {
    runMockScanningAnimation();
  }
}

// Genuine API Fetch Client
async function callGeminiVisionAPI(base64Data, mimeType, apiKey) {
  const prompt = `You are a professional nutrition vision assistant.
Analyze this image. First, determine if the image contains any food items, ingredients, or a food weighing scale.
If the image does NOT contain food or ingredients or a scale with food, return a JSON response with:
{
  "isFoodDetected": false,
  "rejectionMessage": "No food items or ingredients could be identified in this image. Please take a clear photo of your food plate or weighing scale."
}

If food or a scale is detected:
1. Determine if a food weighing scale display is visible. If so, read the numerical weight (assume grams) and set "scaleWeightDetected" to true.
2. Identify the food items and ingredients visible.
3. Estimate their portion weights in grams.
4. Calculate calories and protein.
5. Create a list of the specific detected ingredients/items (e.g. ["Greek yogurt", "blueberries", "honey", "chia seeds"]).
6. Return a JSON response with:
{
  "isFoodDetected": true,
  "name": "Food Name",
  "weightGrams": 150,
  "calories": 250,
  "proteinGrams": 8.0,
  "scaleWeightDetected": true/false,
  "detectedIngredients": ["ingredient 1", "ingredient 2", ...],
  "confidence": "high/medium/low"
}
Format the response strictly as a single JSON object. Do not add any markdown markup or extra text besides the JSON object.`;

  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const textResult = data.candidates[0].content.parts[0].text;
    const parsedData = JSON.parse(textResult);
    
    // Check if the image contains food or scale display
    if (parsedData.isFoodDetected === false) {
      showScannerError("Image Rejected", parsedData.rejectionMessage || "No food or weighing scale could be identified in this image. Please capture a clear photo of your food or ingredients.");
      return;
    }
    
    incrementDailyScanCounter();
    displayScanResults(parsedData);
  } catch (error) {
    console.error('Vision API processing failed:', error);
    showScannerError("AI Scanner Offline", "We are unable to connect to the Gemini Vision AI service. Please verify your internet connection, API Key in Settings, or try again later.");
  }
}

function showScannerError(title, msg) {
  setScannerState('error');
  const errorTitle = document.getElementById('scanner-error-title');
  const errorMsg = document.getElementById('scanner-error-msg');
  if (errorTitle) errorTitle.textContent = title;
  if (errorMsg) errorMsg.textContent = msg;
}

// Mock Scanning Simulation with sequential visual text updates
function runMockScanningAnimation(templateData = null) {
  const statusMsg = document.getElementById('scanner-status-msg');
  
  const steps = [
    { text: "Reading visual display layers...", delay: 600 },
    { text: scannerMode === 'scale' ? "Locating scale numbers..." : "Detecting food edges...", delay: 1200 },
    { text: "Querying nutritional density maps...", delay: 1800 },
    { text: "Confirming calculations...", delay: 2400 }
  ];

  steps.forEach(step => {
    setTimeout(() => {
      statusMsg.textContent = step.text;
    }, step.delay);
  });

  setTimeout(() => {
    // Generate results after completion of step delay
    let mockResult = {};

    if (templateData) {
      // If template trigger
      mockResult = templateData;
    } else {
      // If general capture
      if (scannerMode === 'scale') {
        mockResult = {
          name: "Grilled Chicken Breast",
          weightGrams: 185,
          calories: Math.round(185 * 1.65), // 165 kcal / 100g
          proteinGrams: parseFloat((185 * 0.31).toFixed(1)),
          scaleWeightDetected: true
        };
      } else {
        mockResult = {
          name: "Greek Yogurt Salad Bowl",
          weightGrams: 220,
          calories: 290,
          proteinGrams: 14.5,
          scaleWeightDetected: false
        };
      }
    }

    displayScanResults(mockResult);
  }, 2600);
}

// Display Scanner Results Review Screen
function displayScanResults(result) {
  setScannerState('results');

  const badge = document.getElementById('result-badge-type');
  badge.textContent = result.scaleWeightDetected ? 'Scale Weight Applied' : 'AI Portion Estimate';
  badge.style.backgroundColor = result.scaleWeightDetected ? 'var(--accent-teal)' : 'var(--accent-orange)';

  document.getElementById('result-item-name').textContent = result.name;
  document.getElementById('result-weight').textContent = `${result.weightGrams} g`;
  document.getElementById('result-calories').textContent = `${Math.round(result.calories)} kcal`;
  
  const protein = result.proteinGrams !== undefined ? result.proteinGrams : result.protein;
  document.getElementById('result-protein').textContent = `${protein} g`;

  // Scale Read warnings
  const warningBox = document.getElementById('scale-warning-box');
  if (scannerMode === 'scale' && !result.scaleWeightDetected) {
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
  }

  // Populate ingredients box if ingredients list is returned
  const ingredientsBox = document.getElementById('result-ingredients-box');
  const ingredientsList = document.getElementById('result-ingredients-list');
  if (ingredientsBox && ingredientsList) {
    if (result.detectedIngredients && Array.isArray(result.detectedIngredients) && result.detectedIngredients.length > 0) {
      ingredientsBox.classList.remove('hidden');
      ingredientsList.textContent = result.detectedIngredients.join(', ');
      state.activeScanIngredients = result.detectedIngredients;
    } else {
      ingredientsBox.classList.add('hidden');
      state.activeScanIngredients = null;
    }
  } else {
    state.activeScanIngredients = null;
  }

  // Autofill adjustment inputs
  document.getElementById('result-input-name').value = result.name;
  document.getElementById('result-input-weight').value = result.weightGrams;
  document.getElementById('result-input-calories').value = Math.round(result.calories);
  document.getElementById('result-input-protein').value = protein;
}

function handleAddScannerResult() {
  const name = document.getElementById('result-input-name').value.trim();
  const weight = parseFloat(document.getElementById('result-input-weight').value);
  const calories = parseFloat(document.getElementById('result-input-calories').value);
  const protein = parseFloat(document.getElementById('result-input-protein').value) || 0;

  if (!name || isNaN(weight) || isNaN(calories)) {
    alert('Please enter valid item details.');
    return;
  }

  state.composerItems.push({ 
    name, 
    weightGrams: weight, 
    calories, 
    protein,
    ingredients: state.activeScanIngredients || null
  });
  renderComposerItems();
  closeScanner();
}

// Onboard templates logic
function initScannerTemplates() {
  const container = document.getElementById('mock-templates-container');
  container.querySelectorAll('.btn-mock-template').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      
      let templateData = {};
      if (type === 'food') {
        const name = btn.getAttribute('data-name');
        const ingredients = name.includes('Avocado') 
          ? ["Sourdough Toast", "Creamy Avocado", "Cherry Tomatoes", "Sesame Seeds"]
          : ["Fresh Apple"];
        templateData = {
          name: name,
          weightGrams: parseFloat(btn.getAttribute('data-weight')),
          calories: parseFloat(btn.getAttribute('data-calories')),
          proteinGrams: parseFloat(btn.getAttribute('data-protein')),
          scaleWeightDetected: false,
          detectedIngredients: ingredients
        };
      } else {
        const name = btn.getAttribute('data-name');
        const ingredients = name.includes('Salmon')
          ? ["Grilled Salmon Fillet", "Lemon Slices", "Dill Seasoning"]
          : ["Creamy Peanut Butter"];
        const weight = parseFloat(btn.getAttribute('data-scale'));
        const cal100 = parseFloat(btn.getAttribute('data-cal100'));
        const prot100 = parseFloat(btn.getAttribute('data-protein100'));
        templateData = {
          name: name,
          weightGrams: weight,
          calories: Math.round(weight * (cal100 / 100)),
          proteinGrams: parseFloat((weight * (prot100 / 100)).toFixed(1)),
          scaleWeightDetected: true,
          detectedIngredients: ingredients
        };
      }

      setScannerState('scanning');
      document.getElementById('scanner-image-preview').src = 'icon.svg'; // Placeholder icon preview
      runMockScanningAnimation(templateData);
    });
  });
}

// --------------------------------------------------------------------------
// 10. History SVG Chart Drawing
// --------------------------------------------------------------------------
function renderHistoryChart() {
  const container = document.getElementById('history-chart-container');
  container.innerHTML = '';

  const targetCalories = state.profile ? state.profile.targetCalories : 1800;

  // Retrieve last 7 days keys
  const dateLabels = [];
  const intakeData = [];
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${year}-${month}-${day}`;

    // Label format: "Mon 29"
    const label = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    dateLabels.push({ key, label });

    // Compute Intake
    let dayCals = 0;
    if (state.meals[key]) {
      for (const period of ['breakfast', 'lunch', 'dinner', 'snacks']) {
        state.meals[key][period].forEach(item => {
          dayCals += parseFloat(item.calories || 0);
        });
      }
    }
    intakeData.push(Math.round(dayCals));
  }

  // Stats calculation
  let sumCals = 0;
  let adherenceCount = 0;
  let loggedDaysCount = 0;

  intakeData.forEach((val, i) => {
    if (val > 0) {
      sumCals += val;
      loggedDaysCount++;
      // Adherence rate: daily calories are within range (+/- 100 kcal of target, or lower)
      if (val <= targetCalories + 100) {
        adherenceCount++;
      }
    }
  });

  const avgCalories = loggedDaysCount > 0 ? Math.round(sumCals / loggedDaysCount) : 0;
  const adherenceRate = loggedDaysCount > 0 ? Math.round((adherenceCount / loggedDaysCount) * 100) : 0;

  document.getElementById('stat-avg-calories').textContent = loggedDaysCount > 0 ? `${avgCalories} kcal` : '---';
  document.getElementById('stat-adherence-rate').textContent = loggedDaysCount > 0 ? `${adherenceRate}%` : '---';

  // SVG Dimension setups
  const width = container.clientWidth || 340;
  const height = 200;
  const paddingX = 40;
  const paddingY = 30;

  // Max Calorie ceiling helper
  const maxIntake = Math.max(...intakeData, targetCalories);
  const yCeiling = Math.ceil((maxIntake + 200) / 500) * 500; // Round up to nearest 500

  // Coordinate scales
  const getX = (index) => paddingX + (index * (width - 2 * paddingX) / 6);
  const getY = (value) => height - paddingY - (value * (height - 2 * paddingY) / yCeiling);

  // Build SVG Object
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // 1. Horizontal Grid lines & Y Axis Labels
  const gridTicks = [0, yCeiling / 2, yCeiling];
  gridTicks.forEach(tick => {
    const yVal = getY(tick);
    
    // Grid line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', paddingX);
    line.setAttribute('y1', yVal);
    line.setAttribute('x2', width - paddingX);
    line.setAttribute('y2', yVal);
    line.setAttribute('class', 'chart-grid-line');
    svg.appendChild(line);

    // Grid Label text
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', paddingX - 8);
    txt.setAttribute('y', yVal + 3);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('class', 'chart-axis-text');
    txt.textContent = tick;
    svg.appendChild(txt);
  });

  // 2. Horizontal Target Line
  const yTarget = getY(targetCalories);
  const targetLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  targetLine.setAttribute('x1', paddingX);
  targetLine.setAttribute('y1', yTarget);
  targetLine.setAttribute('x2', width - paddingX);
  targetLine.setAttribute('y2', yTarget);
  targetLine.setAttribute('class', 'chart-target-line');
  svg.appendChild(targetLine);

  // Target Label text
  const targetTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  targetTxt.setAttribute('x', width - paddingX);
  targetTxt.setAttribute('y', yTarget - 6);
  targetTxt.setAttribute('text-anchor', 'end');
  targetTxt.setAttribute('class', 'chart-axis-text');
  targetTxt.setAttribute('fill', 'var(--accent-teal)');
  targetTxt.textContent = `Target: ${targetCalories}`;
  svg.appendChild(targetTxt);

  // 3. Draw Actual Intake Line and Shading Area
  let areaPoints = `M ${getX(0)} ${height - paddingY}`;
  let linePoints = '';

  intakeData.forEach((val, i) => {
    const x = getX(i);
    const y = getY(val);
    if (i === 0) {
      linePoints += `M ${x} ${y}`;
    } else {
      linePoints += ` L ${x} ${y}`;
    }
    areaPoints += ` L ${x} ${y}`;
  });
  areaPoints += ` L ${getX(6)} ${height - paddingY} Z`;

  // Draw Area fill
  const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  areaPath.setAttribute('d', areaPoints);
  areaPath.setAttribute('class', 'chart-intake-area');
  svg.appendChild(areaPath);

  // Draw Line
  const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  linePath.setAttribute('d', linePoints);
  linePath.setAttribute('class', 'chart-intake-line');
  svg.appendChild(linePath);

  // 4. Draw coordinate Dots and X Labels
  intakeData.forEach((val, i) => {
    const x = getX(i);
    const y = getY(val);

    // Coordinate dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', '5');
    dot.setAttribute('class', 'chart-dot');
    
    // Add tooltip text
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${dateLabels[i].label}: ${val} kcal`;
    dot.appendChild(title);
    svg.appendChild(dot);

    // X axis label text
    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', x);
    txt.setAttribute('y', height - paddingY + 18);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('class', 'chart-axis-text');
    txt.textContent = dateLabels[i].label.split(' ')[0]; // Day abbreviation
    svg.appendChild(txt);
  });

  container.appendChild(svg);
}

// --------------------------------------------------------------------------
// 11. Profile Settings Panel Logic
// --------------------------------------------------------------------------
function loadSettingsInputs() {
  if (!state.profile) return;

  const prof = state.profile;
  const units = prof.units || 'imperial';

  document.getElementById('settings-app-title').value = prof.name || 'Elizabeth';
  document.getElementById('settings-units').value = units;
  document.getElementById('settings-age').value = prof.age;
  document.getElementById('settings-activity').value = prof.activity;
  document.getElementById('settings-goal').value = prof.goal;
  document.getElementById('settings-api-key').value = prof.apiKey || '';

  // Preload settings avatar dropdown
  document.getElementById('settings-avatar-select').value = prof.avatar || '🥑';

  // Preload settings meal time ranges
  const ranges = prof.mealRanges || DEFAULT_MEAL_RANGES;
  document.getElementById('settings-breakfast-start').value = ranges.breakfastStart || "06:00";
  document.getElementById('settings-breakfast-end').value = ranges.breakfastEnd || "10:00";
  document.getElementById('settings-lunch-start').value = ranges.lunchStart || "11:30";
  document.getElementById('settings-lunch-end').value = ranges.lunchEnd || "14:30";
  document.getElementById('settings-dinner-start').value = ranges.dinnerStart || "18:00";
  document.getElementById('settings-dinner-end').value = ranges.dinnerEnd || "21:00";

  const weightTitle = document.getElementById('settings-weight-lbl-title');
  const heightFtIn = document.getElementById('settings-height-row-ftin');
  const heightCm = document.getElementById('settings-height-row-cm');

  if (units === 'imperial') {
    weightTitle.textContent = 'Weight (lbs)';
    heightFtIn.classList.remove('hidden');
    heightCm.classList.add('hidden');

    document.getElementById('settings-weight').value = prof.rawWeight || Math.round(prof.weight / 0.45359237);
    document.getElementById('settings-height-ft').value = prof.rawHeightFt || 5;
    document.getElementById('settings-height-in').value = prof.rawHeightIn || 5;
  } else {
    weightTitle.textContent = 'Weight (kg)';
    heightFtIn.classList.add('hidden');
    heightCm.classList.remove('hidden');

    document.getElementById('settings-weight').value = prof.rawWeight || prof.weight;
    document.getElementById('settings-height-cm').value = prof.rawHeightCm || prof.height;
  }

  // Preload Optional Trackers settings
  document.getElementById('settings-toggle-hydration').checked = prof.showHydration !== false;
  document.getElementById('settings-toggle-exercise').checked = prof.showExercise !== false;

  updateApiKeyStatus(prof.apiKey);
  updateSettingsScanUsage();
}

function handleSaveSettings() {
  const name = document.getElementById('settings-app-title').value.trim() || 'Elizabeth';
  const age = parseInt(document.getElementById('settings-age').value);
  const activity = parseFloat(document.getElementById('settings-activity').value);
  const goal = document.getElementById('settings-goal').value;
  const apiKey = document.getElementById('settings-api-key').value.trim();
  const units = document.getElementById('settings-units').value;
  const avatar = document.getElementById('settings-avatar-select').value || '🥑';

  let weightKg = 0;
  let heightCm = 0;
  let rawWeight = 0;
  let rawHeightFt = 0;
  let rawHeightIn = 0;
  let rawHeightCm = 0;

  if (units === 'imperial') {
    rawWeight = parseFloat(document.getElementById('settings-weight').value);
    rawHeightFt = parseInt(document.getElementById('settings-height-ft').value);
    rawHeightIn = parseInt(document.getElementById('settings-height-in').value);

    if (isNaN(rawWeight) || isNaN(rawHeightFt) || isNaN(rawHeightIn) || isNaN(age)) {
      alert('Please enter valid numbers for weight, height, and age.');
      return;
    }

    weightKg = rawWeight * 0.45359237;
    heightCm = (rawHeightFt * 12 + rawHeightIn) * 2.54;
  } else {
    rawWeight = parseFloat(document.getElementById('settings-weight').value);
    rawHeightCm = parseFloat(document.getElementById('settings-height-cm').value);

    if (isNaN(rawWeight) || isNaN(rawHeightCm) || isNaN(age)) {
      alert('Please enter valid numbers for weight, height, and age.');
      return;
    }

    weightKg = rawWeight;
    heightCm = rawHeightCm;
  }

  const mealRanges = {
    breakfastStart: document.getElementById('settings-breakfast-start').value,
    breakfastEnd: document.getElementById('settings-breakfast-end').value,
    lunchStart: document.getElementById('settings-lunch-start').value,
    lunchEnd: document.getElementById('settings-lunch-end').value,
    dinnerStart: document.getElementById('settings-dinner-start').value,
    dinnerEnd: document.getElementById('settings-dinner-end').value
  };

  const showHydration = document.getElementById('settings-toggle-hydration').checked;
  const showExercise = document.getElementById('settings-toggle-exercise').checked;

  const updatedProfile = { 
    ...state.profile, 
    name, age, units,
    weight: weightKg, height: heightCm,
    rawWeight, rawHeightFt, rawHeightIn, rawHeightCm,
    activity, goal, apiKey, avatar,
    mealRanges,
    showHydration,
    showExercise
  };

  const { targetCalories, targetProtein } = calculateNutrientTargets(updatedProfile);

  state.profile = { ...updatedProfile, targetCalories, targetProtein };
  saveState();
  applyTrackerVisibility();
  updateDisplayTitle();
  updateApiKeyStatus(apiKey);

  alert('Settings saved and calorie targets successfully updated!');
}

function updateApiKeyStatus(key) {
  const status = document.getElementById('api-key-status');
  if (key && key.trim() !== '') {
    status.textContent = 'Status: Active (Gemini Vision AI Engine Engaged)';
    status.style.color = '#16a34a'; // Green
  } else {
    status.textContent = 'Status: Running in Mock Demonstration Mode';
    status.style.color = ''; // Default grey
  }
}

async function testApiKey() {
  const key = document.getElementById('settings-api-key').value.trim();
  if (!key) {
    alert('Please enter an API Key to test.');
    return;
  }

  const status = document.getElementById('api-key-status');
  const errorContainer = document.getElementById('settings-api-error-container');
  const errorText = document.getElementById('settings-api-error-text');
  
  status.textContent = 'Testing connection...';
  if (errorContainer) errorContainer.classList.add('hidden');
  
  // Call small test query to verify API key validity
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${key}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
    });

    if (response.ok) {
      alert('Connection Successful! Your Gemini API key is valid.');
      status.textContent = 'Status: Active (Gemini Vision AI Engine Engaged)';
      status.style.color = '#16a34a';
      if (errorContainer) errorContainer.classList.add('hidden');
    } else {
      const errData = await response.json().catch(() => ({}));
      const message = errData.error?.message || `HTTP ${response.status} ${response.statusText}`;
      throw new Error(message);
    }
  } catch (err) {
    // Show error log visually
    if (errorContainer && errorText) {
      errorText.textContent = err.message;
      errorContainer.classList.remove('hidden');
    }
    
    // Auto-copy to clipboard for user convenience
    navigator.clipboard.writeText(err.message).catch(() => {});
    
    alert(`Connection Failed: ${err.message}\n\n(This error has been copied to your clipboard!)`);
    status.textContent = 'Status: Connection Rejected';
    status.style.color = 'var(--accent-danger)';
  }
}

// Bind clipboard copy button action inside settings
document.addEventListener('DOMContentLoaded', () => {
  const copyErrorBtn = document.getElementById('btn-copy-api-error');
  if (copyErrorBtn) {
    copyErrorBtn.addEventListener('click', () => {
      const errText = document.getElementById('settings-api-error-text').textContent;
      navigator.clipboard.writeText(errText).then(() => {
        const originalText = copyErrorBtn.textContent;
        copyErrorBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyErrorBtn.textContent = originalText;
        }, 1500);
      }).catch(e => {
        console.error('Clipboard copy failed:', e);
      });
    });
  }
});

// Hard Reset helper
function handleResetApp() {
  if (confirm('CAUTION: This will permanently delete your profile, saved Gemini API Key, and all logged meals, hydration, and exercise history. This action cannot be undone. Are you sure you want to proceed?')) {
    localStorage.clear();
    window.location.reload();
  }
}

// Exports all user state logs to a readable text file (.txt)
function exportLogsToTextFile() {
  let txt = `=========================================\n`;
  txt += `LIZZY'S PLATE - DATA LOG EXPORT\n`;
  txt += `Generated on: ${new Date().toLocaleString()}\n`;
  txt += `=========================================\n\n`;

  if (state.profile) {
    txt += `USER PROFILE:\n`;
    txt += `- Name: ${state.profile.name || 'Elizabeth'}\n`;
    txt += `- Age: ${state.profile.age || '50'}\n`;
    txt += `- Gender: ${state.profile.gender || 'male'}\n`;
    txt += `- Units: ${state.profile.units || 'imperial'}\n`;
    txt += `- Target Calories: ${state.profile.targetCalories || '---'} kcal\n`;
    txt += `- Target Protein: ${state.profile.targetProtein || '---'}g\n\n`;
  }

  txt += `-----------------------------------------\n`;
  txt += `LOGGED HISTORY:\n`;
  txt += `-----------------------------------------\n\n`;

  // Get all unique dates from meals, water, and exercise
  const allDates = new Set([
    ...Object.keys(state.meals),
    ...Object.keys(state.water),
    ...Object.keys(state.exercise)
  ]);

  const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a)); // Newest first

  if (sortedDates.length === 0) {
    txt += `No logged entries found.\n`;
  } else {
    sortedDates.forEach(date => {
      txt += `DATE: ${date}\n`;
      txt += `-----------------------------------------\n`;

      // Meals
      const dayMeals = state.meals[date] || { breakfast: [], lunch: [], dinner: [], snacks: [] };
      const periods = [
        { id: 'breakfast', label: '🌅 Breakfast' },
        { id: 'lunch', label: '☀️ Lunch' },
        { id: 'dinner', label: '🌙 Dinner' },
        { id: 'snacks', label: '🍎 Snacks' }
      ];

      periods.forEach(p => {
        const items = dayMeals[p.id] || [];
        txt += `${p.label}:\n`;
        if (items.length === 0) {
          txt += `  (No items logged)\n`;
        } else {
          items.forEach(item => {
            txt += `  - ${item.name} (${item.weightGrams}g) | ${item.calories} kcal | ${item.protein}g protein\n`;
            if (item.ingredients && item.ingredients.length > 0) {
              txt += `    🔍 Ingredients: ${item.ingredients.join(', ')}\n`;
            }
          });
        }
      });

      // Water
      const glasses = state.water[date] || 0;
      txt += `💦 Hydration:\n`;
      txt += `  - ${glasses} / 8 glasses of water\n`;

      // Exercise
      const workouts = state.exercise[date] || [];
      txt += `🏃‍♂️ Exercise:\n`;
      if (workouts.length === 0) {
        txt += `  - (No exercise logged)\n`;
      } else {
        workouts.forEach(w => {
          txt += `  - ${w.name} | ${w.duration} mins | ${w.caloriesBurned} kcal burned\n`;
        });
      }

      txt += `\n=========================================\n\n`;
    });
  }

  // Create and download file
  try {
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lizzys_plate_logs_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error exporting file:', err);
    alert('Failed to generate log file download.');
  }
}

// --------------------------------------------------------------------------
// 12. Date Picker Selector Setup
// --------------------------------------------------------------------------
function initDatePicker() {
  const dateBtn = document.getElementById('btn-date-picker');
  const nativePicker = document.getElementById('native-date-picker');
  const dateLabel = document.getElementById('display-date-label');

  // Trigger hidden input on button tap (and route back to meals log if on other panel)
  dateBtn.addEventListener('click', () => {
    const activeTab = document.querySelector('.nav-tab.active')?.getAttribute('data-tab');
    if (activeTab !== 'log') {
      switchTab('log');
    }
    nativePicker.click();
  });

  nativePicker.value = state.currentDate;

  nativePicker.addEventListener('change', (e) => {
    const selected = e.target.value;
    if (!selected) return;

    state.currentDate = selected;
    
    // Label display formats
    const today = getTodayDateString();
    if (selected === today) {
      dateLabel.textContent = 'Today';
    } else {
      const d = new Date(selected + 'T00:00:00'); // Prevent UTC local offsets
      dateLabel.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Refresh Active Section Panels
    const activeTab = document.querySelector('.nav-tab.active')?.getAttribute('data-tab');
    if (activeTab === 'settings') {
      switchTab('log');
    } else if (activeTab === 'dashboard') {
      renderDashboard();
    } else if (activeTab === 'log') {
      renderMealsLog();
    } else if (activeTab === 'history') {
      renderHistoryChart();
    }
  });
}

// --------------------------------------------------------------------------
// 13. System Themes Handling (Light/Dark Mode)
// --------------------------------------------------------------------------
function initTheme() {
  const toggleBtn = document.getElementById('btn-theme-toggle');
  const sunIcon = document.getElementById('icon-sun');
  const moonIcon = document.getElementById('icon-moon');

  // Check saved theme or system preferred
  const savedTheme = localStorage.getItem('auracal_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const currentTheme = savedTheme || (prefersDark ? 'dark' : 'light');
  setTheme(currentTheme);

  toggleBtn.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
  });

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('auracal_theme', theme);

    if (theme === 'dark') {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }
}

// --------------------------------------------------------------------------
// 14. Core Initialization Routing
// --------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initRouter();
  initDatePicker();

  const onboardingScreen = document.getElementById('screen-onboarding');
  const mainScreen = document.getElementById('screen-main');

  const hasProfile = loadState();

  if (hasProfile) {
    onboardingScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    updateDisplayTitle();
    applyTrackerVisibility();
    renderMealsLog(); // Daily Meals Log is the default visible landing page
    renderDashboard();
  } else {
    onboardingScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
    initOnboarding();
  }

  // Register Shortcuts click listeners on Dashboard
  document.querySelectorAll('.btn-shortcut').forEach(btn => {
    btn.addEventListener('click', () => {
      const meal = btn.getAttribute('data-meal');
      openComposer(meal);
    });
  });

  // Floating button log click handler (auto-detects active meal category)
  const floatBtn = document.getElementById('btn-floating-add');
  if (floatBtn) {
    floatBtn.addEventListener('click', () => {
      const activeMeal = detectCurrentMealType();
      openComposer(activeMeal);
    });
  }

  // Composer Modal Category Selector Listener (saves users time if they wish to adjust category)
  const composerMealSelect = document.getElementById('composer-meal-select');
  if (composerMealSelect) {
    composerMealSelect.addEventListener('change', (e) => {
      const selectedMeal = e.target.value;
      state.composerMealType = selectedMeal;
      document.getElementById('composer-meal-type').textContent = selectedMeal.charAt(0).toUpperCase() + selectedMeal.slice(1);
      const composerIcon = document.getElementById('composer-meal-icon');
      if (composerIcon) {
        composerIcon.textContent = getMealPeriodIcon(selectedMeal);
      }
    });
  }

  // Composer Modal actions
  document.getElementById('btn-close-composer').addEventListener('click', closeComposer);
  document.getElementById('btn-composer-cancel').addEventListener('click', closeComposer);
  document.getElementById('btn-composer-save').addEventListener('click', handleSaveMeal);

  // Manual Calculator listener triggers
  document.getElementById('manual-food-name').addEventListener('input', updateManualPreview);
  document.getElementById('manual-food-weight').addEventListener('input', updateManualPreview);
  document.getElementById('manual-food-density').addEventListener('input', updateManualPreview);
  document.getElementById('btn-manual-add-item').addEventListener('click', handleManualAdd);

  // Settings units swap listeners
  const settingsUnits = document.getElementById('settings-units');
  if (settingsUnits) {
    settingsUnits.addEventListener('change', () => {
      const units = settingsUnits.value;
      const weightTitle = document.getElementById('settings-weight-lbl-title');
      const heightFtIn = document.getElementById('settings-height-row-ftin');
      const heightCm = document.getElementById('settings-height-row-cm');

      if (units === 'imperial') {
        weightTitle.textContent = 'Weight (lbs)';
        heightFtIn.classList.remove('hidden');
        heightCm.classList.add('hidden');
      } else {
        weightTitle.textContent = 'Weight (kg)';
        heightFtIn.classList.add('hidden');
        heightCm.classList.remove('hidden');
      }
    });
  }

  // Scanner triggers
  const scanUnifiedBtn = document.getElementById('btn-action-scan-unified');
  if (scanUnifiedBtn) {
    scanUnifiedBtn.addEventListener('click', () => openScanner('unified'));
  }
  document.getElementById('btn-close-scanner').addEventListener('click', closeScanner);
  document.getElementById('btn-scanner-cancel').addEventListener('click', closeScanner);
  document.getElementById('btn-scanner-add').addEventListener('click', handleAddScannerResult);

  const errorRetryBtn = document.getElementById('btn-scanner-error-retry');
  if (errorRetryBtn) {
    errorRetryBtn.addEventListener('click', () => {
      setScannerState('select');
      document.getElementById('camera-file-input').value = '';
    });
  }

  // Camera Upload Listener
  document.getElementById('camera-file-input').addEventListener('change', handleImageUpload);

  // Onboard test templates
  initScannerTemplates();

  // Edit details listeners
  document.getElementById('btn-close-edit').addEventListener('click', closeEditModal);
  document.getElementById('btn-edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('form-edit-item').addEventListener('submit', saveEditItem);

  // Exercise Log UI Triggers
  const dashAddExerciseBtn = document.getElementById('btn-dashboard-add-exercise');
  if (dashAddExerciseBtn) {
    dashAddExerciseBtn.addEventListener('click', openExerciseModal);
  }
  const logAddExerciseBtn = document.getElementById('btn-log-add-exercise');
  if (logAddExerciseBtn) {
    logAddExerciseBtn.addEventListener('click', openExerciseModal);
  }
  
  const closeExerciseBtn = document.getElementById('btn-close-exercise');
  if (closeExerciseBtn) {
    closeExerciseBtn.addEventListener('click', closeExerciseModal);
  }
  const cancelExerciseBtn = document.getElementById('btn-exercise-cancel');
  if (cancelExerciseBtn) {
    cancelExerciseBtn.addEventListener('click', closeExerciseModal);
  }
  const saveExerciseBtn = document.getElementById('btn-exercise-save');
  if (saveExerciseBtn) {
    saveExerciseBtn.addEventListener('click', handleSaveExercise);
  }
  
  const headerLogExercise = document.getElementById('header-log-exercise');
  if (headerLogExercise) {
    headerLogExercise.addEventListener('click', () => {
      const card = document.getElementById('card-log-exercise');
      const list = document.getElementById('list-log-exercise');
      if (card && list) {
        card.classList.toggle('expanded');
        list.classList.toggle('hidden');
      }
    });
  }

  // Settings triggers
  document.getElementById('btn-save-settings').addEventListener('click', handleSaveSettings);
  document.getElementById('btn-test-api-key').addEventListener('click', testApiKey);
  
  // Data Portability & Clear Profile triggers
  const exportBtn = document.getElementById('btn-export-logs');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportLogsToTextFile);
  }
  const resetBtn = document.getElementById('btn-reset-app');
  if (resetBtn) {
    resetBtn.textContent = 'Reset Profile & Start Over';
    resetBtn.addEventListener('click', handleResetApp);
  }

  // No manual click listeners needed for avatar select dropdowns

  // Welcome tips close button listener
  const closeTipsBtn = document.getElementById('btn-close-tips');
  if (closeTipsBtn) {
    closeTipsBtn.addEventListener('click', () => {
      document.getElementById('dashboard-welcome-tips').classList.add('hidden');
      if (state.profile) {
        state.profile.tipsDismissed = true;
        saveState();
      }
    });
  }

  // Settings Header Cog button routing
  const headerSettingsBtn = document.getElementById('btn-header-settings');
  if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener('click', () => {
      switchTab('settings');
    });
  }

  // Header Logo "Home" routing click listener
  const headerLogoHome = document.getElementById('header-logo-home');
  if (headerLogoHome) {
    headerLogoHome.addEventListener('click', () => {
      switchTab('log');
    });
  }

  // Settings Cancel and Go Back action button
  const cancelSettingsBtn = document.getElementById('btn-cancel-settings');
  if (cancelSettingsBtn) {
    cancelSettingsBtn.addEventListener('click', () => {
      switchTab('log');
    });
  }

  // Clear daily logs button listener
  const clearLogsBtn = document.getElementById('btn-clear-day-logs');
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
      if (confirm('Delete all logged food, hydration, and exercise entries for this day?')) {
        const dateKey = state.currentDate;
        state.meals[dateKey] = { breakfast: [], lunch: [], dinner: [], snacks: [] };
        state.water[dateKey] = 0;
        state.exercise[dateKey] = [];
        saveState();
        renderMealsLog();
        renderDashboard();
      }
    });
  }

  // Initialize Avo Mascot Click handlers
  initAvoBuddy();

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[PWA] Service Worker registered successfully', reg.scope))
        .catch(err => console.error('[PWA] Service Worker registration failed', err));
    });
  }
});

// --------------------------------------------------------------------------
// 15. Avo-Buddy Mascot Interactive Logic & Motivation quotes
// --------------------------------------------------------------------------
function updateAvoSpeech() {
  const bubble = document.getElementById('avo-speech-bubble');
  if (!bubble || !state.profile) return;

  const nickname = state.profile.name || 'Elizabeth';
  const dateKey = state.currentDate;
  const todayMeals = state.meals[dateKey] || { breakfast: [], lunch: [], dinner: [], snacks: [] };
  
  // 1. Morning Specific Greeting (5 AM to 11 AM)
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11) {
    if (!todayMeals.breakfast || todayMeals.breakfast.length === 0) {
      bubble.textContent = `"Good morning, ${nickname}! 🌅 A healthy breakfast kickstarts your metabolism. Tap Breakfast below to log your morning meal!"`;
      return;
    }
  }

  // 2. Hydration Check
  const waterCount = state.water[dateKey] || 0;
  if (waterCount === 0) {
    bubble.textContent = `"Avo-Buddy reminder: 💧 Staying hydrated helps filter protein efficiently. Tap a water glass below to record hydration!"`;
    return;
  }

  // 3. Calorie calculations
  const targetCals = state.profile.targetCalories || 2000;
  let eatenCalories = 0;
  for (const period of ['breakfast', 'lunch', 'dinner', 'snacks']) {
    if (todayMeals[period]) {
      todayMeals[period].forEach(item => {
        eatenCalories += parseFloat(item.calories || 0);
      });
    }
  }
  eatenCalories = Math.round(eatenCalories);
  const remaining = targetCals - eatenCalories;

  if (eatenCalories === 0) {
    bubble.textContent = `"Hi ${nickname}! 🥑 Ready to log your plate? Let's track your delicious food entries together today!"`;
  } else if (remaining > 500) {
    bubble.textContent = `"Doing great, ${nickname}! You have eaten ${eatenCalories} kcal and have ${remaining} kcal remaining to reach your target."`;
  } else if (remaining > 0 && remaining <= 500) {
    bubble.textContent = `"So close, ${nickname}! 🌟 Only ${remaining} kcal left for today. You are doing a spectacular job!"`;
  } else if (remaining === 0) {
    bubble.textContent = `"Bingo! 🎯 You hit your calorie target perfectly today. Avo-Buddy is super proud!"`;
  } else {
    bubble.textContent = `"Fully fueled, ${nickname}! 💪 You logged ${eatenCalories} kcal (${Math.abs(remaining)} kcal over target). Excellent job logging!"`;
  }
}

const AVO_TIPS = [
  "Did you know? Avocados are rich in monounsaturated fats that sustain energy and keep cravings away! 🥑",
  "Consistency is the secret ingredient! Log everything—even tiny snacks count. ✨",
  "You're doing fantastic! Avo-Buddy is cheering for your healthy targets today! 🎉",
  "Scanning a scale? Ensure the camera frames the digital display directly for Gemini AI reading! 📸",
  "Protein preserves joint strength and maintains lean muscle tissue over time! 🌟",
  "Take a snapshot of your plate, and my Gemini Vision scanner will estimate portion weight and calories! 📸",
  "Avo-Buddy Tip: Adding protein-rich seeds or nuts to your toast keeps your energy stable all day! 🥜",
  "Want a clean slate? Tap 'Reset Profile & Start Over' in Settings anytime! ⚙️",
  "Hydration raises your metabolic rate! Drink a glass of water right now and tap a cup below! 💧"
];

function initAvoBuddy() {
  const avoBtn = document.getElementById('btn-tap-avo');
  const bubble = document.getElementById('avo-speech-bubble');
  if (!avoBtn || !bubble) return;

  avoBtn.addEventListener('click', () => {
    const currentText = bubble.textContent;
    let newTip = currentText;
    
    // Ensure we pick a new tip
    while (newTip === currentText) {
      const idx = Math.floor(Math.random() * AVO_TIPS.length);
      newTip = `"${AVO_TIPS[idx]}"`;
    }
    
    bubble.textContent = newTip;
    
    // Quick visual bounce reaction
    avoBtn.style.animation = 'none';
    avoBtn.offsetHeight; // trigger layout reflow
    avoBtn.style.animation = 'floatCharacter 3s ease-in-out infinite';
  });
}
