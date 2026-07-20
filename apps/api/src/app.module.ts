import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AccessGuard, CsrfGuard, RolesGuard, TenantGuard } from './auth/guards.js';
import { MeController } from './auth/me.controller.js';
import { RequestContextMiddleware } from './common/http.middleware.js';
import { CursorService } from './common/cursor.js';
import { ProblemDetailsFilter } from './common/problem.js';
import { AppConfig } from './config.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { FilesController } from './files/files.controller.js';
import { FilesService } from './files/files.service.js';
import { HealthController } from './health.controller.js';
import { LearningController } from './learning/learning.controller.js';
import { LearningService } from './learning/learning.service.js';
import { DatabaseService } from './infrastructure/database.service.js';
import { EventsService } from './infrastructure/events.service.js';
import { IdempotencyService } from './infrastructure/idempotency.service.js';
import { StudentController } from './student/student.controller.js';
import { StudentService } from './student/student.service.js';
import { TeacherController } from './teacher/teacher.controller.js';
import { TeacherService } from './teacher/teacher.service.js';
import { TeacherOperationsController } from './teacher/operations.controller.js';
import { TeacherOperationsService } from './teacher/operations.service.js';
import { VocabularyAssessmentController } from './vocabulary/vocabulary-assessment.controller.js';
import { VocabularyAssessmentService } from './vocabulary/vocabulary-assessment.service.js';
import { GrammarPracticeController } from './grammar/grammar-practice.controller.js';
import { GrammarPracticeService } from './grammar/grammar-practice.service.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    MeController,
    StudentController,
    TeacherController,
    TeacherOperationsController,
    AdminController,
    FilesController,
    LearningController,
    VocabularyAssessmentController,
    GrammarPracticeController,
  ],
  providers: [
    AppConfig,
    DatabaseService,
    EventsService,
    IdempotencyService,
    CursorService,
    AuthService,
    StudentService,
    TeacherService,
    TeacherOperationsService,
    AdminService,
    FilesService,
    LearningService,
    VocabularyAssessmentService,
    GrammarPracticeService,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
