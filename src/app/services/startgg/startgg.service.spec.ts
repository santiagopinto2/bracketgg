import { TestBed } from '@angular/core/testing';

import { StartggService } from './startgg.service';

describe('StartggService', () => {
  let service: StartggService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StartggService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
