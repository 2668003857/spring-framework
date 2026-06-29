package com.jiuhong.config;

import com.jiuhong.beanpostprocessors.UserBeanPostProcessor;
import com.jiuhong.service.UserService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AppConfig {

	@Bean
	public UserService userService() {
		return new UserService();
	}

	@Bean
	public UserBeanPostProcessor userBeanPostProcessor() {
		return new UserBeanPostProcessor();
	}

}
